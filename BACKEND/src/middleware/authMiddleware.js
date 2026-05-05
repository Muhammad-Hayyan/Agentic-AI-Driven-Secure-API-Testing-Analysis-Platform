/**
 * @file authMiddleware.js
 * @purpose Express middleware for verifying Ory Network sessions and
 *   performing server-side role-based authorization checks.
 *
 * SECURE CODING PRACTICES APPLIED IN THIS FILE:
 * -----------------------------------------------
 * [Missing or Incorrect Authorization / API1:2023 - BOLA / API5:2023]
 *   - All protected routes call protect() which validates the Ory session
 *     server-side on every request — no client-side trust.
 *   - authorize() enforces role-based access control (RBAC) so that only
 *     users with the required role can access restricted endpoints.
 *
 * [Authentication Bypass]
 *   - Sessions are verified directly with the Ory Network API; a tampered
 *     or expired session cookie is rejected immediately.
 *   - The middleware auto-promotes users listed in ADMIN_EMAILS to admin
 *     role server-side, preventing client-controlled privilege escalation.
 *
 * [API3:2023 - Broken Object Property Level Authorization]
 *   - User records are created/updated from verified Ory identity data only
 *     (email, name from the session object), not from user-supplied request body.
 */

const ory  = require("../lib/ory");
const User = require("../models/User");

/**
 * Admin email list loaded from environment variable ADMIN_EMAILS.
 *
 * [Missing or Incorrect Authorization]
 * - Loaded once at startup from env — never from user input.
 * - Emails are normalized to lowercase to prevent case-sensitivity bypass.
 */
const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (adminEmails.length === 0) {
  console.log("[auth] ADMIN_EMAILS is empty — no email will be auto-promoted to admin.");
} else {
  console.log(`[auth] ADMIN_EMAILS configured: ${adminEmails.join(", ")}`);
}

/**
 * isAdminEmail: Check if a given email is in the admin allow-list.
 *
 * [Missing or Incorrect Authorization]
 * - Comparison is always case-insensitive to prevent bypass via capitalisation.
 *
 * @param {string} email - Email address to check
 * @returns {boolean}    - true if the email is in the admin list
 */
const isAdminEmail = (email) =>
  Boolean(email) && adminEmails.includes(email.toLowerCase());

/**
 * isOryEmailVerified: Determine whether the authenticated Ory identity has a
 * verified email address.
 *
 * Ory typically exposes verification via identity.verifiable_addresses, but we
 * also support common trait/metadata flags for compatibility.
 */
const isOryEmailVerified = (session) => {
  const identity = session?.identity || {};
  const verifiable = Array.isArray(identity.verifiable_addresses) ? identity.verifiable_addresses : [];
  if (verifiable.some((entry) => entry?.verified === true)) {
    return true;
  }

  const traits = identity?.traits || {};
  if (traits.email_verified === true || traits.verified === true) {
    return true;
  }

  const metadataPublic = identity?.metadata_public || {};
  return metadataPublic.email_verified === true || metadataPublic.verified === true;
};

/**
 * protect: Verify an Ory session cookie and attach the authenticated user to req.
 *
 * [Authentication Bypass / API2:2023 - Broken Authentication]
 * - Calls Ory.toSession() which validates the session against the Ory cloud.
 *   A forged or expired cookie will be rejected by Ory.
 * - If no Cookie header is present, access is denied immediately.
 * - If the session is inactive, access is denied.
 *
 * [Missing or Incorrect Authorization]
 * - On first Ory sign-in, a local User record is created or linked.
 * - If the user's email is in ADMIN_EMAILS, they are promoted to admin
 *   server-side — the client cannot request this promotion.
 *
 * [Error Handling]
 * - Generic 401 is returned on any auth failure to avoid leaking internal error details.
 *
 * @param {Object} req  - Express request (reads Cookie header)
 * @param {Object} res  - Express response
 * @param {Function} next - Calls next middleware on success
 */
exports.protect = async (req, res, next) => {
  try {
    const cookie = req.header("Cookie");

    // [Authentication Bypass] Reject requests with no session cookie
    if (!cookie) {
      return res.status(401).json({ success: false, message: "Not authorized to access this route" });
    }

    // [API2:2023 - Broken Authentication] Validate session with Ory cloud API
    const { data: session } = await ory.toSession({ cookie });

    if (!session || !session.active) {
      return res.status(401).json({ success: false, message: "Session expired or invalid" });
    }

    // Extract identity from the verified Ory session — not from request body
    let user = await User.findOne({ oryId: session.identity.id });
    const email         = session.identity.traits.email;
    const name          = session.identity.traits.name || email.split("@")[0];
    const shouldBeAdmin = isAdminEmail(email);
    const emailVerified = isOryEmailVerified(session);

    if (!user) {
      // User exists by email but hasn't signed in via Ory before — link them
      user = await User.findOne({ email });

      if (user) {
        user.oryId = session.identity.id;
        user.isEmailVerified = emailVerified;
        if (shouldBeAdmin && user.role !== "admin") {
          user.role = "admin"; // [Missing or Incorrect Authorization] Server-side role promotion
        }
        await user.save();
      } else {
        // First-time Ory user — create a local record
        user = await User.create({
          oryId:           session.identity.id,
          email:           email,
          name:            name,
          role:            shouldBeAdmin ? "admin" : "user",
          isEmailVerified: emailVerified,
        });
      }
    } else {
      let shouldSave = false;
      if (shouldBeAdmin && user.role !== "admin") {
        // Existing user whose email was added to ADMIN_EMAILS later
        user.role = "admin";
        shouldSave = true;
      }
      if (user.isEmailVerified !== emailVerified) {
        user.isEmailVerified = emailVerified;
        shouldSave = true;
      }
      if (shouldSave) {
        await user.save();
      }
    }

    // Enforce verified email before allowing access to protected API routes.
    if (!emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address before continuing.",
      });
    }

    // Attach the verified user to the request for downstream middleware/controllers
    req.user = user;

    next();
  } catch (err) {
    // [Error Handling] Suppress verbose Ory 401 logs; always return generic 401
    if (err.response?.status !== 401 && err.message !== "Not authorized to access this route") {
      console.error("Ory session verification error:", err.message);
    }
    return res.status(401).json({ success: false, message: "Not authorized to access this route" });
  }
};

/**
 * authorize: Role-based access control gate.
 *
 * [Missing or Incorrect Authorization / API5:2023 - Broken Function Level Authorization]
 * - Must be called after protect() (which populates req.user).
 * - Returns 403 if the authenticated user's role is not in the allowed list.
 * - Prevents regular users from reaching admin-only endpoints server-side.
 * - Uses a generic 403 message so the current role is not disclosed.
 *
 * @param {...string} roles - Allowed role names (e.g., "admin", "user")
 * @returns {Function}      - Express middleware function
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // [API5:2023] Reject if user role is not in the allowed set
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }
    next();
  };
};

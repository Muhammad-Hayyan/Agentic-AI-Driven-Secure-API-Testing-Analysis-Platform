/**
 * @file authController.js
 * @purpose Handles all authentication lifecycle operations:
 *   registration, email verification, login (with MFA), password reset,
 *   TOTP 2FA setup/activation/disable, and logout.
 *
 * SECURE CODING PRACTICES APPLIED IN THIS FILE:
 * -----------------------------------------------
 * [Authentication Bypass]
 *   - Passwords are verified with bcrypt.compare (timing-safe).
 *   - Account lockout is enforced after 5 consecutive failed attempts
 *     (15-minute lock window), mitigating brute-force attacks.
 *   - Generic "Invalid credentials" message is used for both wrong email
 *     and wrong password to prevent user-enumeration attacks.
 *
 * [Authentication Bypass - MFA]
 *   - Time-based One-Time Password (TOTP) via speakeasy library.
 *   - Setup requires confirming the first code before the secret is
 *     promoted to twoFactorSecret, preventing orphaned secrets.
 *
 * [Missing Encryption of Sensitive Data / Token Security]
 *   - JWT tokens are issued as httpOnly cookies (inaccessible to JS,
 *     preventing XSS-based token theft).
 *   - Cookies are flagged secure in production (HTTPS-only).
 *   - SameSite=Lax mitigates CSRF for cookie-based sessions.
 *
 * [Use of Broken Cryptographic Algorithms]
 *   - Email verification and password reset tokens are generated with
 *     crypto.randomBytes(32) and stored as SHA-256 digests — the
 *     raw token travels only in the email link.
 *
 * [Error Handling]
 *   - Errors during email dispatch clean up the token fields from the
 *     database to prevent stale, unconfirmed tokens accumulating.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const sendEmail = require("../utils/email");
const { verificationEmail, resetPasswordEmail, twoFactorEmail } = require("../templates/emailTemplates");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");

const MFA_CHALLENGE_PURPOSE = "login-2fa";
const MFA_CHALLENGE_TTL = "5m";
const GENERIC_RESET_MESSAGE = "If an account exists for that email, a password reset link will be sent.";

/**
 * requireJwtSecret: fail closed when token signing material is absent or weak.
 *
 * [API2:2023 - Broken Authentication / Use of Broken Cryptographic Algorithms]
 * A missing or short JWT secret makes signed sessions forgeable. The secret is
 * read only from environment variables so it is never hardcoded in source.
 *
 * @returns {string} Strong JWT signing secret from environment
 */
const requireJwtSecret = () => {
  const secret = process.env.JWT_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET_KEY must be set to at least 32 characters.");
  }
  return secret;
};

/**
 * signToken: Create a signed JWT for the given user ID.
 *
 * [Token Security / Data Protection]
 * - Signed with JWT_SECRET_KEY from environment (never hardcoded).
 * - 30-day expiry balances UX and session hygiene.
 *
 * @param {string} id - MongoDB ObjectId of the authenticated user
 * @returns {string}  - Signed JWT string
 */
const signToken = (id) => {
  return jwt.sign({ id }, requireJwtSecret(), {
    expiresIn: "1d",
  });
};

/**
 * signMfaChallenge: Issue a short-lived, purpose-bound token for 2FA login.
 *
 * [Authentication Bypass - MFA]
 * This prevents clients from choosing an arbitrary userId during the 2FA step.
 * The verified password step signs the user id into this token, and
 * verifyLogin2FA accepts only this signed challenge.
 *
 * @param {Object} user - User that already passed password authentication
 * @returns {string} 5-minute signed MFA challenge token
 */
const signMfaChallenge = (user) => jwt.sign(
  { id: user._id.toString(), purpose: MFA_CHALLENGE_PURPOSE },
  requireJwtSecret(),
  { expiresIn: MFA_CHALLENGE_TTL }
);

/**
 * sendTokenResponse: Issue a JWT via a secure httpOnly cookie and JSON body.
 *
 * [Missing Encryption of Sensitive Data / CSRF / XSS]
 * - httpOnly: true — prevents client-side JS from reading the token (XSS mitigation).
 * - secure: true in production — cookie is only sent over HTTPS.
 * - sameSite: "Lax" — blocks cross-origin POST requests from sending the cookie (CSRF mitigation).
 * - Password field is explicitly cleared before the user object is sent in the response.
 *
 * If 2FA is required, only a signal is returned (no token); the token is issued
 * only after successful TOTP verification in verifyLogin2FA.
 *
 * @param {Object}  user           - Mongoose User document
 * @param {number}  statusCode     - HTTP status code to respond with
 * @param {Object}  res            - Express response object
 * @param {boolean} is2faRequired  - If true, do not issue token yet
 */
const sendTokenResponse = (user, statusCode, res, is2faRequired = false) => {
  if (is2faRequired) {
    // [Authentication Bypass - MFA] Signed challenge binds the TOTP step to the user who passed password auth.
    return res.status(statusCode).json({
      success: true,
      message: "2FA Required",
      twoFactorRequired: true,
      challengeToken: signMfaChallenge(user),
    });
  }

  const token = signToken(user._id);

  // [Missing Encryption of Sensitive Data] Secure cookie options
  const cookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,                                        // No JS access (XSS protection)
    secure: process.env.NODE_ENV === "production",         // HTTPS-only in production
    sameSite: "Lax",                                       // CSRF protection
  };

  res.cookie("token", token, cookieOptions);

  // [Error Handling] Remove password hash before sending user data to client
  user.password = undefined;

  res.status(statusCode).json({
    success: true,
    token,
    data: { user },
  });
};

/**
 * register: Create a new user account and send an email verification link.
 *
 * Security checks:
 * - Checks for duplicate email before creating the user.
 * - Password policy is enforced by the User schema validator (server-side).
 * - Verification token is generated using CSPRNG and stored as SHA-256 digest.
 * - On email failure, token fields are cleared to prevent stale tokens.
 *
 * @param {Object} req.body - { name, email, password }
 * @returns {Object} 201 JSON success or 400/500 error
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // [Input Validation] Reject duplicate registrations
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // [Authentication Bypass / Error Handling] Generic response avoids account enumeration during registration.
      return res.status(400).json({ success: false, message: "Registration could not be completed with the provided details." });
    }

    // [The Hidden Dangers in Password Handling] Password is hashed by User pre-save hook
    const user = await User.create({ name, email, password });

    // [Use of Broken Cryptographic Algorithms] CSPRNG token, stored as SHA-256 hash
    const verificationToken = user.createVerificationToken();
    await user.save({ validateBeforeSave: false });

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Verify your Topic AI account",
        html: verificationEmail(verifyUrl),
      });

      res.status(201).json({
        success: true,
        message: "Registration successful. Please check your email to verify your account.",
      });
    } catch (err) {
      // [Error Handling] Clean up tokens if email sending fails
      user.verificationToken = undefined;
      user.verificationTokenExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Email could not be sent. Please try again later." });
    }
  } catch (err) {
    console.error("Registration failed:", err.message);
    res.status(500).json({ success: false, message: "Registration could not be completed. Please try again later." });
  }
};

/**
 * verifyEmail: Validate an email verification token and activate the account.
 *
 * Security checks:
 * - Token is re-hashed with SHA-256 before DB lookup — only the digest is stored.
 * - Expiry is checked server-side to reject stale links.
 * - Token fields are cleared after successful use (one-time use).
 *
 * @param {string} req.body.token - The raw verification token from the email URL
 * @returns {Object} 200 success or 400 error
 */
exports.verifyEmail = async (req, res, next) => {
  try {
    // [Use of Broken Cryptographic Algorithms] Re-hash to compare with stored digest
    const hashedToken = crypto.createHash("sha256").update(req.body.token).digest("hex");

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpire: { $gt: Date.now() }, // Token must not be expired
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Token is invalid or has expired" });
    }

    user.isEmailVerified = true;
    user.verificationToken = undefined; // One-time use: clear token after verification
    user.verificationTokenExpire = undefined;
    await user.save();

    res.status(200).json({ success: true, message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error("Email verification failed:", err.message);
    res.status(500).json({ success: false, message: "Email verification could not be completed." });
  }
};

/**
 * resendVerification: Resend email verification link.
 *
 * Security checks:
 * - Only users with unverified emails can request a new token.
 * - New token overwrites the previous one (prevents token accumulation).
 *
 * @param {string} req.body.email - User's email address
 * @returns {Object} 200 success or 400/404 error
 */
exports.resendVerification = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      // [Error Handling / Authentication Bypass] Generic response prevents email enumeration.
      return res.status(200).json({ success: true, message: "If the email is registered and unverified, a verification link will be sent." });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: "Email is already verified" });
    }

    // Overwrite any existing (possibly stale) token
    const verificationToken = user.createVerificationToken();
    await user.save({ validateBeforeSave: false });

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;

    await sendEmail({
      email: user.email,
      subject: "Verify your Topic AI account",
      html: verificationEmail(verifyUrl),
    });

    res.status(200).json({ success: true, message: "Verification email resent." });
  } catch (err) {
    console.error("Resend verification failed:", err.message);
    res.status(500).json({ success: false, message: "Verification email could not be sent." });
  }
};

/**
 * login: Authenticate a user with email and password.
 *
 * Security checks:
 * - Generic "Invalid credentials" message for both bad email and bad password
 *   to prevent user-enumeration attacks (Authentication Bypass).
 * - Account lockout: After 5 failed attempts, lock for 15 minutes.
 * - Login attempts counter is reset on successful login.
 * - If 2FA is enabled, a token is NOT issued yet — the client must complete
 *   TOTP verification via verifyLogin2FA.
 * - Email must be verified before a session token is issued.
 *
 * @param {Object} req.body - { email, password }
 * @returns {Object} 200 with token, 401 invalid creds, 423 account locked
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // [Input Validation] Require both fields before any DB operation
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Please provide email and password" });
    }

    // Fetch lockout fields alongside password hash
    const user = await User.findOne({ email }).select("+password +twoFactorSecret +loginAttempts +lockUntil");

    // [Authentication Bypass] Return same error for unknown email and wrong password
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // [Authentication Bypass - Account Lockout] Block login if account is temporarily locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const remainingMinutes = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.`,
      });
    }

    // [The Hidden Dangers in Password Handling] bcrypt.compare is timing-safe
    const isMatch = await user.comparePassword(password, user.password);

    if (!isMatch) {
      // Increment failed attempt counter
      user.loginAttempts += 1;

      // [Authentication Bypass - Account Lockout] Lock for 15 minutes after 5 failures
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000;
        await user.save();
        return res.status(423).json({
          success: false,
          message: "Too many failed attempts. Account locked for 15 minutes.",
        });
      }

      await user.save();
      // [Authentication Bypass] Generic message — does not reveal which credential was wrong
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // [Authorization] Unverified users cannot access the system
    if (!user.isEmailVerified) {
      return res.status(403).json({ success: false, message: "Please verify your email first", emailNotVerified: true });
    }

    // Reset lockout counters on successful authentication
    user.loginAttempts = 0;
    user.lockUntil = undefined;

    // [Authentication Bypass - MFA] If 2FA enabled, require TOTP before issuing token
    if (user.isTwoFactorEnabled) {
      await user.save();
      return sendTokenResponse(user, 200, res, true);
    }

    user.lastLogin = Date.now();
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (err) {
    console.error("Login failed:", err.message);
    res.status(500).json({ success: false, message: "Login could not be completed. Please try again later." });
  }
};

/**
 * verifyLogin2FA: Complete login by verifying the TOTP code.
 *
 * [Authentication Bypass - MFA]
 * - The signed challenge token proves this user already passed password auth.
 * - The TOTP code is verified against the user's stored secret using
 *   speakeasy with time-based window tolerance.
 * - Token is only issued after successful TOTP verification.
 *
 * @param {Object} req.body - { challengeToken, token }
 * @returns {Object} 200 with JWT or 401 invalid code
 */
exports.verifyLogin2FA = async (req, res, next) => {
  try {
    const { challengeToken, token } = req.body;

    if (!challengeToken || !token) {
      return res.status(400).json({ success: false, message: "Authentication code is required" });
    }

    let challenge;
    try {
      challenge = jwt.verify(challengeToken, requireJwtSecret());
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired 2FA challenge" });
    }

    if (challenge.purpose !== MFA_CHALLENGE_PURPOSE) {
      return res.status(401).json({ success: false, message: "Invalid or expired 2FA challenge" });
    }

    const user = await User.findById(challenge.id).select("+twoFactorSecret");

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid or expired 2FA challenge" });
    }

    // [Authentication Bypass - MFA] TOTP verification via speakeasy
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token,
    });

    if (!verified) {
      return res.status(401).json({ success: false, message: "Invalid authentication code" });
    }

    user.lastLogin = Date.now();
    await user.save();

    // [Token Security] Issue JWT only after both password and TOTP are validated
    sendTokenResponse(user, 200, res);
  } catch (err) {
    console.error("2FA verification failed:", err.message);
    res.status(500).json({ success: false, message: "2FA verification could not be completed." });
  }
};

/**
 * forgotPassword: Send a password reset link to the user's email.
 *
 * [Use of Broken Cryptographic Algorithms]
 * - Reset token is a CSPRNG 32-byte hex value, stored as SHA-256 digest.
 * - Token expires in 10 minutes to limit the attack window.
 *
 * [Error Handling]
 * - If email dispatch fails, token fields are cleared to prevent accumulation
 *   of valid-but-undelivered reset links in the database.
 *
 * @param {string} req.body.email - Account email address
 * @returns {Object} 200 success or 404/500 error
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      // [Error Handling / Authentication Bypass] Same response for existing and non-existing emails prevents account enumeration.
      return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Reset your Topic AI password",
        html: resetPasswordEmail(resetUrl),
      });

      res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    } catch (err) {
      // [Error Handling] Clear tokens so the broken link cannot be reused
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Email could not be sent" });
    }
  } catch (err) {
    console.error("Forgot password failed:", err.message);
    res.status(500).json({ success: false, message: "Password reset could not be started." });
  }
};

/**
 * resetPassword: Apply a new password using a valid reset token.
 *
 * [Use of Broken Cryptographic Algorithms]
 * - Token is re-hashed to match the stored digest (raw token never stored).
 * - Expiry is checked server-side.
 *
 * [The Hidden Dangers in Password Handling]
 * - Setting user.password triggers the pre-save bcrypt hook automatically.
 * - Password policy is validated by the User schema before hashing.
 *
 * @param {Object} req.body - { token, password }
 * @returns {Object} 200 success or 400 invalid token
 */
exports.resetPassword = async (req, res, next) => {
  try {
    // [Use of Broken Cryptographic Algorithms] Re-hash for DB comparison
    const hashedToken = crypto.createHash("sha256").update(req.body.token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }, // Token must not be expired
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    // [The Hidden Dangers in Password Handling] bcrypt hashing triggered by pre-save hook
    user.password = req.body.password;
    user.resetPasswordToken = undefined; // Invalidate token after use
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("Password reset failed:", err.message);
    res.status(500).json({ success: false, message: "Password reset could not be completed." });
  }
};

/**
 * setup2FA: Generate a TOTP secret and QR code for 2FA enrollment.
 *
 * [Authentication Bypass - MFA]
 * - The secret is stored temporarily in twoFactorAuthTempSecret.
 * - It is only moved to twoFactorSecret after the user confirms via activate2FA,
 *   preventing partial/broken 2FA setup from being silently activated.
 *
 * @returns {Object} { dataUrl (QR code), secret (base32) }
 */
exports.setup2FA = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    const secret = speakeasy.generateSecret({
      name: `Topic AI (${user.email})`,
    });

    // Store temporarily — not active until confirmed in activate2FA
    user.twoFactorAuthTempSecret = secret.base32;
    await user.save();

    const dataUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({
      success: true,
      dataUrl,
      secret: secret.base32,
    });
  } catch (err) {
    console.error("2FA setup failed:", err.message);
    res.status(500).json({ success: false, message: "2FA setup could not be completed." });
  }
};

/**
 * activate2FA: Confirm a TOTP code and promote the temp secret to active.
 *
 * [Authentication Bypass - MFA]
 * - Requires the user to prove they can generate a valid TOTP code before
 *   2FA is activated. Prevents saving a broken secret the user can never use.
 *
 * @param {string} req.body.token - TOTP code from the authenticator app
 * @returns {Object} 200 success or 400 invalid code
 */
exports.activate2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user.id).select("+twoFactorAuthTempSecret");

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorAuthTempSecret,
      encoding: "base32",
      token,
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: "Invalid verification code" });
    }

    // [Authentication Bypass - MFA] Promote temp secret to active only after verification
    user.twoFactorSecret = user.twoFactorAuthTempSecret;
    user.twoFactorAuthTempSecret = undefined;
    user.isTwoFactorEnabled = true;
    await user.save();

    res.status(200).json({ success: true, message: "Two-Factor Authentication activated successfully." });
  } catch (err) {
    console.error("2FA activation failed:", err.message);
    res.status(500).json({ success: false, message: "2FA activation could not be completed." });
  }
};

/**
 * disable2FA: Disable TOTP after re-verifying the user's password.
 *
 * [Authentication Bypass - MFA]
 * - Requires password re-verification before disabling 2FA, preventing
 *   an attacker with a session cookie from silently removing 2FA.
 *
 * @param {string} req.body.password - User's current password
 * @returns {Object} 200 success or 401 invalid password
 */
exports.disable2FA = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user.id).select("+password");

    // [Authentication Bypass] Require password before disabling security feature
    if (!(await user.comparePassword(password, user.password))) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    user.twoFactorSecret = undefined;
    user.isTwoFactorEnabled = false;
    await user.save();

    res.status(200).json({ success: true, message: "Two-Factor Authentication disabled" });
  } catch (err) {
    console.error("2FA disable failed:", err.message);
    res.status(500).json({ success: false, message: "2FA could not be disabled." });
  }
};

/**
 * logout: Invalidate the session by overwriting the auth cookie.
 *
 * [Token Security / Secure Session Handling]
 * - The cookie is overwritten with "none" and set to expire in 10 seconds,
 *   effectively evicting the token from the browser's cookie jar.
 * - httpOnly remains true so the invalidation cannot be blocked by client JS.
 *
 * @returns {Object} 200 success message
 */
exports.logout = async (req, res, next) => {
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({ success: true, message: "Logged out successfully" });
};

/**
 * getMe: Return the currently authenticated user's profile.
 *
 * [Missing or Incorrect Authorization]
 * - Uses req.user.id set by authMiddleware (Ory session verified server-side).
 * - Only retrieves the requesting user's own data (BOLA prevention).
 *
 * @returns {Object} 200 with authenticated user data
 */
exports.getMe = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  res.status(200).json({ success: true, data: user });
};

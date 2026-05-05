# TopicAI Demo Preparation Guide (Full Code-to-Feature Map)

This document is a **demo/viva script + technical map** for your project.  
It explains:

1. End-to-end user and admin flows (what happens first, then next)
2. Which file/function implements which behavior
3. Where each behavior appears in UI
4. Which libraries are used and why

---

## 1) High-Level Architecture

- **Backend**: Express + MongoDB + Ory session verification + AI scanning (OpenAI/Gemini)
- **Frontend (user portal)**: Next.js app for signup/login/project upload/scans/reports/settings
- **Admin portal**: Next.js app for user governance, newsletter, inquiries, notifications, audit, global projects/vulnerabilities
- **Auth model**:
  - Primary: Ory browser flows via Next proxy (`/api/ory-api`)
  - Backend access enforcement: `protect()` middleware verifies Ory session server-side
  - Role enforcement: `authorize("user")` / `authorize("admin")`

---

## 2) End-to-End Flow You Can Explain in Demo

## 2.1 User Auth + Entry Flow

1. User opens signup/login UI (`frontend/app/signup/page.js`, `frontend/app/login/page.js`)
2. Frontend calls Ory SDK through internal proxy:
   - `frontend/lib/ory.js` (`basePath: /api/ory-api`)
   - `frontend/app/api/ory-api/[...paths]/route.js` forwards to Ory securely
3. After auth, app calls backend `/api/v1/auth/me` via `getMe()` (`frontend/services/authService.js`)
4. Backend route `authRoutes` protects `/me` with `protect` (`BACKEND/src/routes/authRoutes.js`)
5. `protect()` (`BACKEND/src/middleware/authMiddleware.js`) verifies Ory session via `ory.toSession({ cookie })`
6. `protect()` links/creates local user and sets `req.user`
7. Dashboard and protected pages render through `ProtectedRoute` (`frontend/components/ProtectedRoute.js`)

### Important current behavior

- Signup now logs out Ory session after registration to avoid auto-login (`frontend/app/signup/page.js`)
- Backend `protect()` enforces email verification before protected API access (`BACKEND/src/middleware/authMiddleware.js`)

---

## 2.2 Project Upload -> Vault -> Scan -> Report

1. User uploads code from `frontend/app/dashboard/projects/page.js` (`handleUpload`)
2. Request hits `POST /api/v1/projects` (`BACKEND/src/routes/projectRoutes.js`)
3. Route middleware stack:
   - `protect()`
   - `authorize("user")`
   - `multer` file validation
   - `audit("CREATE_PROJECT")`
4. `createProject()` (`BACKEND/src/controllers/projectController.js`):
   - reads temp file
   - encrypts file with vault service (`BACKEND/src/utils/vaultService.js`)
   - writes only encrypted `.enc` to vault
   - deletes plaintext temp file
5. User clicks scan (`triggerScan` in projects page)
6. `POST /api/v1/projects/:id/scan` -> `triggerScan()`:
   - verifies ownership (`{ _id, user: req.user.id }`)
   - decrypts source in memory
   - runs `runSAST()` (`aiScannerService.js`)
   - runs `runDAST()` (`sandboxService.js`)
   - stores normalized vulnerabilities in DB
7. User opens report page (`frontend/app/dashboard/projects/[id]/page.js`)
8. UI fetches `/api/v1/projects/:id/report` -> `getReport()` and renders findings, severity, export/print

---

## 2.3 Admin Governance Flow

1. Admin logs in via Ory (`admin/app/login/page.js`, `admin/services/adminService.js`)
2. Root admin shell (`admin/components/RootAdminLayout.js`) calls `getMe()`
3. If role != admin, UI redirects to `/login`
4. Admin pages call backend admin endpoints (`/api/v1/admin/*`)
5. Backend admin routes enforce:
   - `protect()`
   - `authorize("admin")`
6. Admin can manage users, projects, vulnerabilities, audit logs, newsletter, inquiries, notifications

---

## 3) Backend File-by-File, Function-by-Function

## 3.1 Entry / Config / Infra

### `BACKEND/src/index.js`
- **What it does**: Bootstraps API server and global security middleware.
- **Key responsibilities**:
  - Helmet CSP headers
  - CORS allowlist (`CLIENT_URL`, `ADMIN_URL`)
  - Global rate limit + slowdown
  - Request sanitization (`customSanitizer`)
  - Route mounting
  - Global error handler (generic messages in production)
- **UI impact**: affects all frontend/admin API calls.

### `BACKEND/src/config/db.js`
- `connectDB`: connects Mongoose using env variables.
- **UI impact**: entire app data layer.

### `BACKEND/src/config/cloudinary.js`
- Configures Cloudinary + multer storage for avatars.
- Exports `upload` middleware for user profile avatar updates.
- **UI impact**: user/admin settings avatar upload.

### `BACKEND/src/lib/ory.js`
- Creates Ory FrontendApi client for server-side session verification.
- **UI impact**: all protected backend routes.

---

## 3.2 Middleware

### `BACKEND/src/middleware/authMiddleware.js`
- `isAdminEmail` (internal): checks env allowlist
- `isOryEmailVerified` (internal): checks verification from Ory session object
- `protect`:
  - validates session via Ory
  - links/creates local user
  - syncs `isEmailVerified`
  - enforces verified email before protected route access
  - attaches `req.user`
- `authorize(...roles)`:
  - RBAC gate, returns 403 if role not allowed
- **UI impact**: all authenticated user/admin APIs.

### `BACKEND/src/middleware/auditMiddleware.js`
- `audit(action)`: wraps `res.json` and stores `AuditLog` with user/action/resource/status/IP/UA.
- **UI impact**: logs visible in user logs page + admin audit page.

---

## 3.3 Routes

### `BACKEND/src/routes/authRoutes.js`
- Endpoints:
  - `POST /register`
  - `POST /verify-email`
  - `POST /resend-verification`
  - `POST /login`
  - `POST /login/2fa`
  - `POST /forgot-password`
  - `POST /reset-password`
  - `GET /logout`
  - `GET /me` (protected)
  - `POST /setup-2fa` (protected)
  - `POST /activate-2fa` (protected)
  - `POST /disable-2fa` (protected)
- Includes strict auth rate limiter.
- **UI impact**: login/settings/forgot/reset/verify pages.

### `BACKEND/src/routes/userRoutes.js`
- `PUT /profile` (avatar upload + profile update)
- `PUT /password`
- Protected globally via `router.use(protect)`.
- **UI impact**: user/admin settings pages.

### `BACKEND/src/routes/projectRoutes.js`
- Protected and user-role-authorized globally.
- Functions wired:
  - `GET /` -> `getProjects`
  - `POST /` -> `createProject` + `upload.single("code")` + `audit("CREATE_PROJECT")`
  - `GET /stats/overview` -> `getProjectStats`
  - `GET /:id` and `GET /:id/report` -> `getReport`
  - `DELETE /:id` -> `deleteProject` + `audit("DELETE_PROJECT")`
  - `POST /:id/scan` -> `triggerScan` + `audit("TRIGGER_SCAN")`
- **UI impact**: dashboard, projects, reports.

### `BACKEND/src/routes/notificationRoutes.js`
- Protected routes:
  - `GET /` -> `getNotifications`
  - `PUT /:id/read` -> `markAsRead`
  - `DELETE /:id` -> `hideNotification`
- **UI impact**: notification bell and notifications page.

### `BACKEND/src/routes/adminRoutes.js`
- Protected + admin-authorized globally.
- Covers stats, users, projects, vulnerabilities, newsletter, contacts, admin notifications.
- **UI impact**: all admin pages.

### `BACKEND/src/routes/auditRoutes.js`
- `GET /logs`, `GET /stats`, `DELETE /purge`, `DELETE /:id`
- Protected by `protect` (query logic in controller scopes by role).
- **UI impact**: user logs page and admin audit stats.

### `BACKEND/src/routes/newsletterRoutes.js`
- `POST /subscribe` -> `subscribe`
- **UI impact**: newsletter signup component.

### `BACKEND/src/routes/contactRoutes.js`
- `POST /` -> `submitContactForm`
- **UI impact**: contact submission APIs (if wired from UI).

### `BACKEND/src/routes/sysRoutes.js`
- `GET /inventory` -> `getInventory`
- **UI impact**: system inventory endpoint.

---

## 3.4 Controllers

### `BACKEND/src/controllers/authController.js`
Internal helpers:
- `requireJwtSecret`
- `signToken`
- `signMfaChallenge`
- `sendTokenResponse`

Exported functions:
- `register`: create user + email verification token + send verification email
- `verifyEmail`: validate token and mark user verified
- `resendVerification`: issue new verify token and send email
- `login`: password login + lockout + optional 2FA challenge token
- `verifyLogin2FA`: validates signed challenge + TOTP, then issues auth cookie
- `forgotPassword`: generates reset token and sends reset email
- `resetPassword`: validates token and updates password
- `setup2FA`: creates temp TOTP secret + returns QR
- `activate2FA`: verifies code and finalizes 2FA
- `disable2FA`: verifies password and disables 2FA
- `logout`: clears token cookie
- `getMe`: returns authenticated user profile
- **UI impact**: login/signup/verify/reset/settings/admin settings.

### `BACKEND/src/controllers/projectController.js`
- `createProject`: secure upload + vault encryption + temp cleanup
- `triggerScan`: ownership check + decrypt + AI SAST/DAST + store findings + notifications/audit
- `getReport`: fetches one project + vulnerabilities
- `getProjects`: list user projects + per-project findings summary
- `deleteProject`: ownership check + cascade delete findings + delete project
- `getProjectStats`: aggregate vulnerability counts and weighted grade
- **UI impact**: user dashboard/projects/reports.

### `BACKEND/src/controllers/notificationController.js`
- `getNotifications`
- `hideNotification`
- `markAsRead`
- `adminCreateNotification`
- `adminGetNotifications`
- `adminDeleteNotification`
- `adminPurgeNotifications`
- **UI impact**: user bell/page and admin broadcast center.

### `BACKEND/src/controllers/adminController.js`
Internal helper:
- `sendAdminServerError`

Exported:
- `getStats`: global admin dashboard counts
- `getUsers`, `updateUser`, `deleteUser`
- `getSubscribers`, `sendNewsletter`
- `getInquiries`, `updateInquiry`, `deleteInquiry`, `replyToInquiry`
- `getAuditLogs`, `getAuditStats`, `deleteAuditLog`, `purgeAuditLogs`
- `getAllProjects`
- `getAllVulnerabilities`
- **UI impact**: every admin management page.

### `BACKEND/src/controllers/userController.js`
- `updateProfile`
- `updatePassword`
- **UI impact**: user/admin settings.

### `BACKEND/src/controllers/contactController.js`
- `submitContactForm`: store inquiry + notify support + send acknowledgement mail.
- **UI impact**: contact pipeline.

### `BACKEND/src/controllers/newsletterController.js`
- `subscribe`: validate + store subscriber + send welcome mail.
- **UI impact**: newsletter signup.

### `BACKEND/src/controllers/sysController.js`
- `getInventory`: returns version/compliance/security feature inventory.

---

## 3.5 Models

### `BACKEND/src/models/User.js`
- Schema for identity, role, verification, lockout, 2FA fields.
- Methods:
  - `comparePassword`
  - `createVerificationToken`
  - `createPasswordResetToken`
- Hook:
  - `pre("save")` bcrypt hash.
- **UI impact**: auth, settings, admin user management.

### `BACKEND/src/models/Project.js`
- Project metadata, owner, scan status/settings, vault path.

### `BACKEND/src/models/Vulnerability.js`
- Vulnerability records with severity/type/mitigation/status.

### `BACKEND/src/models/Notification.js`
- Notification records with recipient/readBy/hiddenBy.

### `BACKEND/src/models/AuditLog.js`
- Immutable activity events for audit page.

### `BACKEND/src/models/Contact.js`
- Contact inquiry records.

### `BACKEND/src/models/Newsletter.js`
- Newsletter subscriber records.

---

## 3.6 Utilities / Templates / Scripts

### `BACKEND/src/utils/aiScannerService.js`
- `normalizeSeverity` (internal)
- `runSAST`: builds system+user prompt, calls OpenAI/Gemini, parses JSON, normalizes findings, stores vulnerabilities.

### `BACKEND/src/utils/sandboxService.js`
- `normalizeSeverity` (internal)
- `runDAST`: prompts AI from endpoint list, parses JSON, normalizes and stores findings.

### `BACKEND/src/utils/vaultService.js`
- `encrypt`, `decrypt`, `secureDelete`
- Uses AES-256-CBC + scrypt-derived key + random IV.

### `BACKEND/src/utils/sanitizer.js`
- `sanitizeValue`, `deepSanitize`, `customSanitizer`
- Sanitizes body/query/params for XSS + NoSQL operator injection.

### `BACKEND/src/utils/email.js`
- `sendEmail`: Nodemailer SMTP sender.

### `BACKEND/src/templates/emailTemplates.js`
- `verificationEmail`
- `resetPasswordEmail`
- `twoFactorEmail`
- `contactNotificationEmail`
- `contactAcknowledgementEmail`
- `newsletterWelcomeEmail`
- `contactReplyEmail`

### `BACKEND/src/scripts/seedAdmin.js`
- Seeds first admin safely from env.

### `BACKEND/src/scripts/promoteAdmin.js`
- CLI script to promote existing user to admin by email.

---

## 4) Frontend (User Portal) File-by-File, Function-by-Function

## 4.1 Auth + Proxy + API Services

### `frontend/lib/ory.js`
- Creates Ory SDK instance pointed to `/api/ory-api`.

### `frontend/app/api/ory-api/[...paths]/route.js`
- Proxy handlers: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- Internal helpers:
  - `resolveOrySdkUrl`
  - `rewriteSetCookie`
  - `canIncludeBody`
  - `isTextLikeContentType`
  - `handleProxy`
- **Purpose**: server-side Ory forwarding, cookie rewriting, redirect hardening, timeout handling.

### `frontend/services/authService.js`
- Ory flow methods:
  - `createLoginFlow`
  - `createRegistrationFlow`
  - `submitRegistration`
  - `submitLogin`
  - `getSession`
  - `logout`
- Legacy/backend auth methods:
  - `register`, `login`, `verifyLogin2FA`
  - `getMe`, `setup2FA`, `activate2FA`, `disable2FA`
  - `forgotPassword`, `resetPassword`
  - `verifyEmail`, `resendVerification`

### `frontend/services/userService.js`
- `updateProfile`, `updatePassword`

### `frontend/services/notificationService.js`
- `getNotifications`, `markAsRead`, `deleteNotification`

### `frontend/services/contactService.js`
- `submitContact`

### `frontend/services/newsletterService.js`
- `subscribeNewsletter`

---

## 4.2 User Auth Pages

### `frontend/app/login/page.js`
- `LoginPage`
- `initFlow` (inside effect): init Ory login flow + session checks
- `handleSubmit`: submit Ory login, enforce backend authorization via `getMe`, handle verification cases
- **UI feature**: secure sign-in with Ory + safe error toasts.

### `frontend/app/signup/page.js`
- `SignupPage`
- `initFlow`: starts Ory registration flow
- `handleSubmit`: submit registration + explicit logout after signup (prevents auto-login)

### `frontend/app/verify-email/page.js`
- `VerifyEmailPage`, `VerifyEmailContent`, `handleVerify`
- **UI**: token verification state machine (verifying/success/error).

### `frontend/app/resend-verification/page.js`
- `ResendVerificationPage`, `handleSubmit`

### `frontend/app/forgot-password/page.js`
- `ForgotPasswordPage`, `handleSubmit`
- Uses enumeration-safe message.

### `frontend/app/reset-password/page.js`
- `ResetPasswordPage`, `ResetPasswordContent`, `handleSubmit`

---

## 4.3 User App (Dashboard & Operations)

### `frontend/app/dashboard/page.js`
- `DashboardOverview`
- `fetchData`: loads profile + projects and computes overview stats
- **UI cards**: active projects, completed scans, critical risks.

### `frontend/app/dashboard/projects/page.js`
- `ProjectsPage`
- `fetchProjects`: list projects
- `handleUpload`: create project with source file
- `triggerScan`: start background AI scan
- `handleDelete`: delete project with confirmation
- **UI**: project lifecycle management.

### `frontend/app/dashboard/projects/[id]/page.js`
- `ProjectDetailsPage`
- `fetchProjectData`, `refreshProjectData`
- `handleScan`, `executeDelete`
- `handleExportJSON`, `handlePrint`
- `getSeverityColor`
- **UI**: full project report, severity grouping, export/print, rescan.

### `frontend/app/dashboard/reports/page.js`
- `ReportsPage`
- `fetchReports` (completed projects)
- `fetchStats` (aggregate grade/risk)
- Uses charts (`recharts`) for severity and comparison.

### `frontend/app/dashboard/logs/page.js`
- `LogsPage`
- `fetchLogs`, `fetchStats`
- `handleDelete`, `handlePurge`
- `getStatusIcon`, `getActionColor`
- **UI**: audit history + purge controls.

### `frontend/app/settings/page.js`
- `SettingsPage`
- `fetchUser`
- `handleProfileUpdate`
- `handlePasswordUpdate`
- `handleSetup2FA`
- `handleActivate2FA`
- **UI**: profile/password/2FA.

### `frontend/app/notifications/page.js`
- `NotificationsPage`
- `initPage`, `fetchNotifications`
- `handleDelete`
- `handleMarkAllRead`
- `getIcon`

---

## 4.4 User Layout + Components

### `frontend/components/ProtectedRoute.js`
- `ProtectedRoute` + internal `checkAuth`
- Redirect logic for unauthorized and admin-role users.

### `frontend/components/Header.js`
- `Header`
- `checkAuth`
- `handleLogout`
- Safely caches display-only user data in `localStorage`.

### `frontend/components/NotificationBell.js`
- `NotificationBell`
- `fetchNotifications`
- `handleMarkRead`
- Polls notifications and handles rate-limit backoff.

### `frontend/components/AuthLayout.js`
- Shared auth-page layout.

### `frontend/components/ConfirmModal.js`
- Shared confirmation modal.

### Static/marketing components
- `Hero`, `Features`, `ModelGrid`, `Newsletter`, `CTASection`, `Footer`
- **UI**: public landing pages.

---

## 4.5 Public Static Pages (User Frontend)

These files mostly export a single component and render informational content:

- `frontend/app/page.js` (home)
- `frontend/app/overview/page.js`
- `frontend/app/pricing/page.js`
- `frontend/app/models/page.js`
- `frontend/app/docs/page.js`
- `frontend/app/about/page.js`
- `frontend/app/careers/page.js`
- `frontend/app/privacy/page.js`
- `frontend/app/terms/page.js`
- `frontend/app/cookies/page.js`
- `frontend/app/ory/page.js`
- `frontend/app/layout.js`
- `frontend/app/notifications/layout.js`
- `frontend/app/settings/layout.js`
- `frontend/app/robots.js`
- `frontend/app/sitemap.js`

Note: `frontend/app/contact/page.js` currently renders a visual form, but it is not wired to `submitContact` yet.

---

## 5) Admin Portal File-by-File, Function-by-Function

## 5.1 Admin Auth + Services

### `admin/lib/ory.js`
- Ory client for admin app (`/api/ory-api`).

### `admin/app/api/ory-api/[...paths]/route.js`
- Ory proxy for admin app (similar to frontend proxy).

### `admin/services/adminService.js`
- Ory auth:
  - `createLoginFlow`, `submitLogin`, `getSession`, `logout`
- Legacy/admin auth:
  - `adminLogin`, `adminVerify2FA`, `getMe`
  - `updateProfile`, `updatePassword`
  - `setup2FA`, `activate2FA`, `disable2FA`
- Admin data operations:
  - `getStats`, `getAuditStats`
  - `getUsers`, `updateUser`, `deleteUser`
  - `getAllAdminProjects`, `getAllAdminVulnerabilities`
  - `getAdminAuditLogs`
  - `getSubscribers`, `sendNewsletter`
  - `getInquiries`, `updateInquiry`, `deleteInquiry`, `replyToInquiry`
  - `getAdminNotifications`, `createNotification`, `deleteNotification`, `purgeNotifications`

---

## 5.2 Admin App Pages

### `admin/app/login/page.js`
- `AdminLoginPage`
- `initFlow`
- `handleSubmit`

### `admin/app/dashboard/page.js`
- `AdminDashboard`
- `fetchStats`
- Shows total users/subscribers/inquiries/verification + audit activity.

### `admin/app/users/page.js`
- `UserManagement`
- `fetchUsers`
- `handleStatusToggle` (verify/unverify)
- `handleDelete`
- `handleRoleToggle`

### `admin/app/projects/page.js`
- `AdminProjectsPage`
- `fetchProjects`
- Global project list + severity summary.

### `admin/app/vulnerabilities/page.js`
- `AdminVulnerabilitiesPage`
- `fetchVulnerabilities`
- Severity/project filters + prioritized sorting.

### `admin/app/audit/page.js`
- `AdminAuditPage`
- `fetchLogs`
- `getStatusIcon`
- `filteredLogs` computation (search + status filter)

### `admin/app/newsletter/page.js`
- `NewsletterManagement`
- `sanitizePreviewHtml`
- `fetchSubscribers`
- `handleSend`
- `handleCopyPrompt`
- `handleExportCSV`

### `admin/app/inquiries/page.js`
- `ContactManagement`
- `fetchInquiries`
- `handleStatusUpdate`
- `handleDelete`
- `handleSendReply`

### `admin/app/notifications/page.js`
- `NotificationsPage`
- `fetchNotifications`
- `handleSubmit`
- `handleDelete`
- `handlePurge`
- `getTypeIcon`

### `admin/app/settings/page.js`
- `AdminSettingsPage`
- `fetchAdmin`
- `handleProfileUpdate`
- `handlePasswordUpdate`
- `handleSetup2FA`
- `handleActivate2FA`
- `handleDisable2FA`

### Light pages/layout files
- `admin/app/page.js`
- `admin/app/layout.js`
- `admin/app/dashboard/settings/page.js`

---

## 5.3 Admin Components

### `admin/components/RootLayoutWrapper.js`
- Chooses whether to wrap route inside admin shell (`RootAdminLayout`).

### `admin/components/RootAdminLayout.js`
- `checkAdmin` role check via backend `getMe()`
- Renders sidebar + topbar shell.

### `admin/components/AdminSidebar.js`
- `handleLogout`
- Navigation links for all admin modules.

### `admin/components/AdminLayoutWrapper.js`
- Pass-through wrapper currently.

### `admin/components/AuthLayout.js`
- Shared layout for admin login.

### `admin/components/ConfirmModal.js`
- Shared destructive-action confirmation UI.

---

## 6) Libraries and What They Are Used For

## 6.1 Backend libraries (`BACKEND/package.json`)

- `express`: API framework
- `mongoose`: MongoDB ODM (models/schemas)
- `dotenv`: env var loading
- `cors`: CORS policy
- `helmet`: security headers/CSP
- `express-rate-limit`: request throttling
- `express-slow-down`: progressive response delay under abuse
- `cookie-parser`: cookie extraction
- `jsonwebtoken`: JWT signing (legacy/manual auth flows)
- `bcryptjs`: password hashing/comparison
- `speakeasy`: TOTP 2FA generation/verification
- `qrcode`: QR generation for authenticator setup
- `nodemailer`: SMTP transactional mail
- `cloudinary` + `multer-storage-cloudinary` + `multer`: avatar uploads
- `adm-zip`: zip extraction for scan intake
- `sanitize-html`: sanitization support
- `openai`: OpenAI API client for SAST/DAST
- `@google/generative-ai`: Gemini client for fallback AI scanning
- `@ory/client`: Ory session verification client
- `lodash`: utility helpers
- `nodemon` (dev): auto restart backend

## 6.2 Frontend libraries (`frontend/package.json`)

- `next`, `react`, `react-dom`: web app framework/runtime
- `axios`: HTTP client for backend APIs
- `@ory/client`, `@ory/integrations`: Ory browser auth flows
- `react-hot-toast`: toasts
- `lucide-react`: icons
- `recharts`: report charts
- `tailwindcss`, `@tailwindcss/postcss`: styling

## 6.3 Admin libraries (`admin/package.json`)

- Same core as frontend (`next`, `react`, `axios`, `@ory/client`, `react-hot-toast`, `lucide-react`)
- `framer-motion`: UI animations
- `clsx`, `tailwind-merge`: className composition helpers

---

## 7) Security Features You Should Highlight in Demo

- Server-side Ory session verification in `protect()`
- RBAC via `authorize()` on admin/user routes
- BOLA protections in project + notification controllers
- Email verification enforcement in auth middleware
- Strict auth rate limiting + global throttling
- CSP + security headers via Helmet
- CORS origin allowlist (no wildcard)
- Input sanitization for XSS/NoSQL injection
- Encrypted vault storage for uploaded source code (AES-256-CBC + scrypt key derivation)
- Safe AI output normalization before DB writes
- Generic production error responses (no stack leakage)
- Full audit logging middleware with user/action/resource/status/IP/UA

---

## 8) Quick Demo Script (Suggested)

1. Login/signup flow -> mention Ory proxy and backend `protect()`
2. Upload project -> mention file allowlist, size limits, vault encryption
3. Trigger scan -> mention AI provider selection and normalized finding persistence
4. Open reports -> show severity analytics + remediation details
5. Open logs -> show immutable action trail and audit stats
6. Open settings -> show password change and 2FA setup flow
7. Switch to admin -> show RBAC boundary and global governance modules
8. End with security summary mapped to OWASP API Top 10 controls

---

## 9) Notes / Current Gaps To Be Aware Of (If Asked)

- User contact page (`frontend/app/contact/page.js`) is currently presentational UI and not wired to `submitContact`.
- Ory proxy in admin app currently differs from frontend proxy hardening (frontend has improved no-body response handling and quieter error exposure).
- Mixed auth model exists (Ory-first + legacy auth endpoints) for compatibility; useful to explain as transitional architecture.


import axios from "axios";
import { ory } from "../lib/ory";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const API_URL = `${API_BASE_URL}/auth`;

const api = axios.create({
  baseURL: API_URL,
  // [CSRF / Secure Session Handling] Sends only httpOnly SameSite cookies managed by the backend/Ory proxy.
  withCredentials: true,
});

// --- Ory Authentication ---

/**
 * Initiates a login flow.
 */
export const createLoginFlow = async () => {
  const { data } = await ory.createBrowserLoginFlow();
  return data;
};

/**
 * Initiates a registration flow.
 */
export const createRegistrationFlow = async () => {
  const { data } = await ory.createBrowserRegistrationFlow();
  return data;
};

/**
 * Submits a registration flow.
 */
export const submitRegistration = async (flowId, formData, csrfToken) => {
  const { data } = await ory.updateRegistrationFlow({
    flow: flowId,
    updateRegistrationFlowBody: {
      method: "password",
      password: formData.password,
      csrf_token: csrfToken,
      traits: {
        email: formData.email,
      },
    },
  });
  return data;
};

/**
 * Submits a login flow.
 */
export const submitLogin = async (flowId, formData, csrfToken) => {
  const { data } = await ory.updateLoginFlow({
    flow: flowId,
    updateLoginFlowBody: {
      method: "password",
      password: formData.password,
      identifier: formData.email,
      csrf_token: csrfToken,
    },
  });
  return data;
};

/**
 * Checks if the user is authenticated.
 */
export const getSession = async () => {
  try {
    const { data } = await ory.toSession();
    return data;
  } catch (err) {
    return null;
  }
};

/**
 * Logs the user out of Ory. Best-effort: if the session is already gone or the
 * flow call errors, we still want the caller to proceed with local cleanup.
 */
export const logout = async () => {
  try {
    const { data } = await ory.createBrowserLogoutFlow();
    if (data?.logout_token) {
      await ory.updateLogoutFlow({ token: data.logout_token });
    }
  } catch {
    // 401 here usually means "no active session", which is fine for logout.
    // We intentionally suppress detailed client-side logout errors to avoid
    // leaking proxy/auth internals in browser logs.
  }
};

// --- Legacy / Backend specific (Can be removed later) ---

export const register = async (userData) => {
  const response = await api.post("/register", userData);
  return response.data;
};

export const login = async (userData) => {
  const response = await api.post("/login", userData);
  return response.data;
};

export const verifyLogin2FA = async (challengeToken, token) => {
  // [Authentication Bypass - MFA] challengeToken is signed by the server after password auth; the client never chooses userId.
  const response = await api.post("/login/2fa", { challengeToken, token });
  return response.data;
};

export const getMe = async () => {
  const response = await api.get("/me");
  return response.data;
};

export const setup2FA = async () => {
  const response = await api.post("/setup-2fa");
  return response.data;
};

export const activate2FA = async (token) => {
  const response = await api.post("/activate-2fa", { token });
  return response.data;
};

export const disable2FA = async (password) => {
  const response = await api.post("/disable-2fa", { password });
  return response.data;
};

export const forgotPassword = async (email) => {
  // [Account Enumeration] Backend returns a generic success message whether the email exists or not.
  const response = await api.post("/forgot-password", { email });
  return response.data;
};

export const resetPassword = async (token, password) => {
  // [Token Security] Reset token is sent once over HTTPS and stored only as a hash server-side.
  const response = await api.post("/reset-password", { token, password });
  return response.data;
};

export const verifyEmail = async (token) => {
  const response = await api.post("/verify-email", { token });
  return response.data;
};

export const resendVerification = async (email) => {
  const response = await api.post("/resend-verification", { email });
  return response.data;
};

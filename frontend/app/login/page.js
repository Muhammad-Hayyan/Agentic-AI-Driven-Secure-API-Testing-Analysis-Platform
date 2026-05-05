"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthLayout from "@/components/AuthLayout";
import { createLoginFlow, submitLogin, getSession } from "@/services/authService";
import { toast } from "react-hot-toast";
import { LogIn, Key, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [flow, setFlow] = useState(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  useEffect(() => {
    const INIT_MS = 30_000;
    const withTimeout = (promise, ms) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("LOGIN_FLOW_TIMEOUT")), ms)
        ),
      ]);

    const initFlow = async () => {
      let existing = null;
      try {
        existing = await getSession();
      } catch {
        existing = null;
      }
      if (existing?.active) {
        router.replace("/dashboard");
        return;
      }

      try {
        const flowData = await withTimeout(createLoginFlow(), INIT_MS);
        setFlow(flowData);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("Login flow initialization failed");
        }
        if (err.message === "LOGIN_FLOW_TIMEOUT") {
          toast.error("Login setup timed out. Check ORY_SDK_URL / NEXT_PUBLIC_ORY_SDK_URL and restart the dev server.");
        } else if (err.response?.status === 400) {
          window.location.href = "/dashboard";
        } else {
          toast.error("Failed to initialize login. Check .env has ORY_SDK_URL or NEXT_PUBLIC_ORY_SDK_URL for the Ory proxy.");
        }
      }
    };
    initFlow();
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!flow) {
      toast.error("Login flow not initialized.");
      return;
    }

    setLoading(true);
    try {
      const csrfToken = flow.ui.nodes.find(node => node.attributes.name === "csrf_token")?.attributes.value;
      if (!csrfToken) {
        toast.error("Security token missing. Refresh the page or check Ory / cookie settings.");
        return;
      }
      // [CSRF] Ory requires the flow-specific csrf_token from trusted UI nodes before accepting login.
      await submitLogin(flow.id, formData, csrfToken);
      toast.success("Welcome back!");
      router.push("/dashboard");
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Login request failed");
      }

      const uiMessages = err.response?.data?.ui?.messages || [];
      const nodeMessages = (err.response?.data?.ui?.nodes || [])
        .flatMap(node => (node.messages || []).map(m => ({
          text: m.text,
          field: node.attributes?.name,
        })));

      const allMessages = [
        ...uiMessages.map(m => m.text),
        ...nodeMessages.map(m => m.field ? `${m.field}: ${m.text}` : m.text),
      ];
      const message = allMessages[0] || err.response?.data?.error?.reason || err.response?.data?.error?.message || "Invalid credentials.";
      toast.error(message);

      if (err.response?.status === 410 || err.response?.status === 403) {
        try {
          const flowData = await createLoginFlow();
          setFlow(flowData);
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout 
      title="Welcome back" 
      subtitle="Enter your details to access your account."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-charcoal-warm font-sans flex items-center gap-2">
            <LogIn className="w-4 h-4" /> Email address
          </label>
          <input 
            type="email" 
            required
            className="w-full bg-warm-sand/20 border border-border-cream rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 transition-all font-sans"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="email@example.com"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-charcoal-warm font-sans flex items-center gap-2">
              <Key className="w-4 h-4" /> Password
            </label>
            <Link href="/forgot-password" size="sm" className="text-sm text-stone-gray hover:text-near-black transition-colors italic">
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <input 
              type={showPassword ? "text" : "password"} 
              required
              className="w-full bg-warm-sand/20 border border-border-cream rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 transition-all font-sans"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
            />
            <button 
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-gray hover:text-near-black transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading || !flow}
          className="btn-terracotta w-full py-4 text-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Continue"} <ArrowRight className="w-5 h-5" />
        </button>

        <p className="text-center text-sm text-stone-gray font-sans">
          Don't have an account?{" "}
          <Link href="/signup" className="text-near-black font-semibold hover:text-terracotta transition-colors underline underline-offset-4">
            Sign up for free
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

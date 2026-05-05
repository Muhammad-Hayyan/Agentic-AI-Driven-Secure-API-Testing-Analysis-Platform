"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { createRegistrationFlow, submitRegistration } from "@/services/authService";
import { toast } from "react-hot-toast";
import { User, LogIn, Key, ArrowRight, Eye, EyeOff, CheckCircle2, Circle } from "lucide-react";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [flow, setFlow] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    // Initialize Ory Registration Flow
    const initFlow = async () => {
      try {
        const flowData = await createRegistrationFlow();
        setFlow(flowData);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("Registration flow initialization failed");
        }
        if (err.response?.status === 400) {
          // If a session already exists or the flow is stale, redirect to login or dashboard
          window.location.href = "/login";
        } else {
          toast.error("Failed to initialize registration. Please try again.");
        }
      }
    };
    initFlow();
  }, []);

  const passwordRequirements = [
    { label: "Minimum 8 characters", regex: /.{8,}/ },
    { label: "Uppercase letter", regex: /[A-Z]/ },
    { label: "Lowercase letter", regex: /[a-z]/ },
    { label: "Number", regex: /[0-9]/ },
    { label: "Special character (@$!%*?&)", regex: /[@$!%*?&]/ },
  ];

  const isPasswordSecure = passwordRequirements.every(req => req.regex.test(formData.password));

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!isPasswordSecure) {
      toast.error("Please meet all password requirements.");
      return;
    }

    if (!flow) {
      toast.error("Registration flow not initialized.");
      return;
    }

    setLoading(true);
    try {
      const csrfToken = flow.ui.nodes.find(node => node.attributes.name === "csrf_token")?.attributes.value;
      await submitRegistration(flow.id, formData, csrfToken);
      toast.success("Account created successfully!");
      setIsSuccess(true);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Registration request failed");
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

      const message = allMessages[0] || err.response?.data?.error?.message || "Registration failed. Please try again.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <AuthLayout 
        title="Welcome aboard!" 
        subtitle={`Your account has been created for ${formData.email}.`}
      >
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-warm-sand/30 rounded-full flex items-center justify-center mx-auto mb-6 text-terracotta">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <p className="text-olive-gray mb-8 font-sans">
            Your account is ready. You can now log in to the platform and start testing your APIs.
          </p>
          <Link href="/login" className="btn-warm-sand block w-full py-4 text-center">
            Go to Login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title="Create your account" 
      subtitle="Join thousand of thoughtful teams using automation."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-charcoal-warm font-sans flex items-center gap-2">
            <User className="w-4 h-4" /> Full name
          </label>
          <input 
            type="text" 
            required
            className="w-full bg-warm-sand/20 border border-border-cream rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 transition-all font-sans"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>

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
          <label className="text-sm font-medium text-charcoal-warm font-sans flex items-center gap-2">
            <Key className="w-4 h-4" /> Password
          </label>
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
          
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {passwordRequirements.map((req, i) => {
              const met = req.regex.test(formData.password);
              return (
                <div key={i} className={`flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold transition-colors ${met ? "text-green-600" : "text-stone-gray/50"}`}>
                  {met ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3 opacity-20" />}
                  {req.label}
                </div>
              );
            })}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading || !flow}
          className="btn-terracotta w-full py-4 text-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create Account"} <ArrowRight className="w-5 h-5" />
        </button>

        <p className="text-center text-sm text-stone-gray font-sans">
          Already have an account?{" "}
          <Link href="/login" className="text-near-black font-semibold hover:text-terracotta transition-colors underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

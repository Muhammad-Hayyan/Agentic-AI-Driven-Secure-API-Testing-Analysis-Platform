"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getMe, logout } from "@/services/adminService";
import AdminSidebar from "./AdminSidebar";
import { Loader2, Bell, Search, User } from "lucide-react";

const safeAvatarUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

export default function RootAdminLayout({ children }) {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    checkAdmin();
  }, []);

  const checkAdmin = async () => {
    try {
      // [Authorization / RBAC] This client check is UX only; backend admin APIs still enforce protect()+authorize("admin").
      const res = await getMe();
      if (res.data.role !== "admin") {
        await logout();
        router.push("/login?error=unauthorized");
      } else {
        setAdmin(res.data);
        setIsAuthorized(true);
      }
    } catch (err) {
      await logout();
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-parchment flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-terracotta animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <div className="flex-grow bg-parchment overflow-x-hidden transition-all duration-300">
        
        <header className="h-20 border-b border-border-cream px-12 flex items-center justify-end sticky top-0 bg-parchment/80 backdrop-blur-md z-30">
          <div className="flex items-center gap-6">
            <Link 
              href="/notifications"
              className="relative w-11 h-11 flex items-center justify-center bg-warm-sand/30 text-stone-gray hover:text-near-black hover:bg-warm-sand/50 rounded-xl transition-all shadow-sm"
            >
              <Bell className="w-5 h-5" />
            </Link>
            
            <div className="h-8 w-px bg-border-cream" />
            
            <Link href="/settings" className="flex items-center gap-3 hover:opacity-80 transition-opacity group">
              <div className="text-right">
                <p className="text-sm font-semibold text-near-black group-hover:text-terracotta transition-colors">{admin?.name}</p>
                <p className="text-[10px] uppercase font-bold text-terracotta tracking-wider">Super Admin</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-warm-sand border border-border-cream overflow-hidden flex items-center justify-center group-hover:border-terracotta/50 transition-colors">
                {safeAvatarUrl(admin?.avatar) ? (
                  <img src={safeAvatarUrl(admin.avatar)} alt="Admin" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-stone-gray" />
                )}
              </div>
            </Link>
          </div>
        </header>

        <main className="p-12 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

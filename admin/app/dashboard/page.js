"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayoutWrapper from "@/components/AdminLayoutWrapper";
import { getStats, getAuditStats } from "@/services/adminService";
import { 
  Users, Mail, MessageSquare, TrendingUp, 
  ArrowUpRight, ArrowDownRight, ShieldCheck, Activity, ArrowRight
} from "lucide-react";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [auditStats, setAuditStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [statsRes, auditRes] = await Promise.all([
        getStats(),
        getAuditStats()
      ]);
      setStats(statsRes.data);
      setAuditStats(auditRes?.data || { success: 0, failure: 0, total: 0 });
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Admin dashboard stats request failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: "Total Users", value: stats?.totalUsers || "0", icon: Users, trend: "+12.5%", positive: true },
    { label: "Subscribers", value: stats?.totalSubscribers || "0", icon: Mail, trend: "+5.2%", positive: true },
    { label: "Active Inquiries", value: stats?.newInquiries || "0", icon: MessageSquare, trend: "-2", positive: false },
    { label: "Email Verified", value: `${Math.round((stats?.verifiedUsers / stats?.totalUsers) * 100) || 0}%`, icon: ShieldCheck, trend: "Stable", positive: true },
  ];

  return (
    <AdminLayoutWrapper>
      <div className="mb-12">
        <h1 className="text-4xl mb-2">Security Infrastructure</h1>
        <p className="text-olive-gray font-sans">Real-time snapshots of the DevSecOps AI Platform core services.</p>
      </div>

      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {statCards.map((card, i) => (
          <div key={i} className="bg-ivory border border-border-cream rounded-3xl p-6 shadow-whisper relative overflow-hidden group">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-warm-sand/50 rounded-xl flex items-center justify-center text-terracotta group-hover:scale-110 transition-transform duration-300">
                <card.icon className="w-6 h-6" />
              </div>
              <div className={`flex items-center gap-1 text-xs font-bold font-mono px-2 py-1 rounded-full ${
                card.positive ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"
              }`}>
                {card.trend}
                {card.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              </div>
            </div>
            <p className="text-stone-gray text-xs font-bold uppercase tracking-widest mb-1">{card.label}</p>
            <p className="text-3xl font-serif text-near-black">{card.value}</p>
            
            
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-terracotta/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div className="lg:col-span-2 bg-ivory border border-border-cream rounded-[32px] p-8 shadow-whisper">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-terracotta" />
              <h2 className="text-2xl font-serif">Audit Activity</h2>
            </div>
            <select className="bg-warm-sand/20 border border-border-cream rounded-lg px-3 py-1 text-xs font-sans outline-none">
              <option>All Time</option>
            </select>
          </div>
          
          <div className="h-64 flex items-end gap-6 px-12 justify-center">
            
            <div className="w-1/3 bg-green-500/80 rounded-t-lg relative group transition-all hover:bg-green-600/80 flex justify-center"
                 style={{ height: `${Math.max(10, Math.min(100, (auditStats?.success / (auditStats?.total || 1)) * 100))}%` }}>
              <div className="absolute bottom-full mb-2 bg-near-black text-ivory text-xs font-bold px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {auditStats?.success || 0} Successful
              </div>
              <span className="absolute bottom-4 text-white font-mono text-xs hidden sm:block pointer-events-none">SUCCESS</span>
            </div>
            
            <div className="w-1/3 bg-terracotta/80 rounded-t-lg relative group transition-all hover:bg-terracotta flex justify-center"
                 style={{ height: `${Math.max(10, Math.min(100, (auditStats?.failure / (auditStats?.total || 1)) * 100))}%` }}>
              <div className="absolute bottom-full mb-2 bg-near-black text-ivory text-xs font-bold px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {auditStats?.failure || 0} Failed
              </div>
              <span className="absolute bottom-4 text-white font-mono text-xs hidden sm:block pointer-events-none">FAILED</span>
            </div>

          </div>
        </div>

        
        <div className="bg-near-black rounded-[32px] p-8 text-ivory shadow-whisper flex flex-col justify-between overflow-hidden relative group">
          <div className="relative z-10">
            <h2 className="text-2xl font-serif mb-6">Action Hub</h2>
            <div className="space-y-4">
              <Link href="/newsletter" className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors group/btn">
                <div className="text-left">
                  <p className="text-sm font-medium">Broadcast</p>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest">Newsletter</p>
                </div>
                <ArrowRight className="w-4 h-4 text-terracotta group-hover/btn:translate-x-1 transition-transform" />
              </Link>
              <Link href="/users" className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors group/btn">
                <div className="text-left">
                  <p className="text-sm font-medium">Review Users</p>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest">Compliance</p>
                </div>
                <ArrowRight className="w-4 h-4 text-terracotta group-hover/btn:translate-x-1 transition-transform" />
              </Link>
              <Link href="/inquiries" className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors group/btn">
                <div className="text-left">
                  <p className="text-sm font-medium">Support</p>
                  <p className="text-[10px] opacity-40 uppercase tracking-widest">Inquiries</p>
                </div>
                <ArrowRight className="w-4 h-4 text-terracotta group-hover/btn:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
          <p className="text-xs opacity-40 font-serif italic mt-12 relative z-10">All signals normal.</p>
        </div>
      </div>
    </AdminLayoutWrapper>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/services/authService";
import Header from "@/components/Header";
import ProtectedRoute from "@/components/ProtectedRoute";
import { 
  Loader2, 
  BrainCircuit, 
  Zap, 
  ShieldAlert, 
  Plus, 
  Shield, 
  Terminal, 
  FileBarChart2, 
  ChevronRight,
  ShieldCheck
} from "lucide-react";
import axios from "axios";
import Link from "next/link";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1",
  withCredentials: true
});

export default function DashboardOverview() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    totalProjects: 0,
    completedScans: 0,
    criticalFindings: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [meRes, projectsRes] = await Promise.all([
          getMe(),
          api.get("/projects")
        ]);
        
        setUser(meRes.data);
        const projects = projectsRes.data.data;
        const criticalFindings = projects.reduce(
          (sum, project) => sum + (project.findingsSummary?.critical || 0),
          0
        );

        setStats({
          totalProjects: projects.length,
          completedScans: projects.filter(p => p.scanStatus === "completed").length,
          criticalFindings,
        });
      } catch (err) {
        
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const statCards = [
    { label: "Active Projects", value: stats.totalProjects, icon: Zap, color: "text-terracotta", bg: "bg-terracotta/10", link: "/dashboard/projects" },
    { label: "Security Scans", value: stats.completedScans, icon: BrainCircuit, color: "text-green-600", bg: "bg-green-50", link: "/dashboard/reports" },
    { label: "Critical Risks", value: stats.criticalFindings, icon: ShieldAlert, color: "text-red-600", bg: "bg-red-50", link: "/dashboard/reports" },
  ];

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-parchment">
        <Header />
        <main className="flex-grow py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <header className="mb-12">
              <p className="text-terracotta font-mono text-xs uppercase tracking-widest font-bold mb-2">Workspace Overview</p>
              <h1 className="text-4xl font-serif text-near-black">Welcome back, {user?.name?.split(' ')[0]}</h1>
            </header>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-10 h-10 text-terracotta animate-spin" />
              </div>
            ) : (
              <div className="space-y-12">
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {statCards.map((stat, i) => (
                    <Link 
                      key={i} 
                      href={stat.link}
                      className="bg-ivory border border-border-cream rounded-[32px] p-8 shadow-whisper group hover:border-terracotta/30 transition-all"
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center ${stat.color} group-hover:scale-110 transition-transform`}>
                          <stat.icon className="w-6 h-6" />
                        </div>
                        <ChevronRight className="w-5 h-5 text-border-cream group-hover:text-terracotta transition-colors" />
                      </div>
                      <p className="text-stone-gray text-sm font-medium mb-1">{stat.label}</p>
                      <p className="text-4xl font-serif text-near-black">{stat.value}</p>
                    </Link>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  <div className="lg:col-span-2 space-y-8">
                    <div className="bg-near-black rounded-[40px] p-10 text-ivory shadow-2xl relative overflow-hidden group">
                      <div className="relative z-10 max-w-lg">
                        <h2 className="text-3xl font-serif mb-4">Start a new analysis</h2>
                        <p className="text-ivory/60 mb-8 leading-relaxed">Securely upload your source code to our ephemeral sandbox. Our AI engine will perform a deep SAST/DAST scan within minutes.</p>
                        <button 
                          onClick={() => router.push("/dashboard/projects")}
                          className="bg-terracotta hover:bg-terracotta/90 text-ivory px-8 py-4 rounded-2xl flex items-center gap-3 transition-all"
                        >
                          <Plus className="w-5 h-5" /> Initialize Project
                        </button>
                      </div>
                      <Shield className="absolute -bottom-10 -right-10 w-64 h-64 text-ivory/5 group-hover:text-terracotta/10 transition-colors duration-700" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <Link href="/dashboard/logs" className="bg-ivory border border-border-cream rounded-[32px] p-8 shadow-whisper hover:border-terracotta/30 transition-all flex items-center gap-6">
                        <div className="w-14 h-14 bg-warm-sand/50 rounded-2xl flex items-center justify-center text-near-black">
                          <Terminal className="w-7 h-7" />
                        </div>
                        <div>
                          <h3 className="font-serif text-xl">Audit Trail</h3>
                          <p className="text-xs text-stone-gray mt-1">Review system activities</p>
                        </div>
                      </Link>
                      <Link href="/dashboard/reports" className="bg-ivory border border-border-cream rounded-[32px] p-8 shadow-whisper hover:border-terracotta/30 transition-all flex items-center gap-6">
                        <div className="w-14 h-14 bg-warm-sand/50 rounded-2xl flex items-center justify-center text-near-black">
                          <FileBarChart2 className="w-7 h-7" />
                        </div>
                        <div>
                          <h3 className="font-serif text-xl">Security Insights</h3>
                          <p className="text-xs text-stone-gray mt-1">View detailed reports</p>
                        </div>
                      </Link>
                    </div>
                  </div>

                  
                  <div className="bg-ivory border border-border-cream rounded-[40px] p-8 shadow-whisper flex flex-col">
                    <div className="flex items-center justify-between mb-8">
                       <h2 className="text-2xl font-serif text-near-black">Health</h2>
                       <div className="flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                         <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">Operational</span>
                       </div>
                    </div>
                    
                    <div className="space-y-8 flex-grow">
                      <div>
                        <div className="flex justify-between text-xs font-mono mb-2 opacity-60">
                          <span>API LATENCY</span>
                          <span>24ms</span>
                        </div>
                        <div className="h-1.5 bg-warm-sand/30 rounded-full overflow-hidden">
                          <div className="h-full bg-terracotta w-[85%]" />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-mono mb-2 opacity-60">
                          <span>VAULT LOAD</span>
                          <span>12%</span>
                        </div>
                        <div className="h-1.5 bg-warm-sand/30 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 w-[12%]" />
                        </div>
                      </div>
                      <div className="pt-8 border-t border-border-cream/50">
                        <div className="flex items-center gap-4 mb-4">
                           <ShieldCheck className="w-5 h-5 text-green-600" />
                           <p className="text-sm font-medium text-near-black">Protocol Shield Active</p>
                        </div>
                        <p className="text-xs text-olive-gray leading-relaxed">All API requests are currently being sanitized through the Custom Express 5 Neutralizer.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}

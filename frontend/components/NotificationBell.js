"use client";

import { useEffect, useState, useRef } from "react";
import { Bell, Info, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { getNotifications, markAsRead } from "@/services/notificationService";
import Link from "next/link";

/**
 * POLL_INTERVAL_MS: How often the bell re-fetches notifications while the
 * user is on any dashboard page. 60 seconds is enough for near-real-time
 * awareness without burning through the backend rate limit budget.
 * [API4:2023 - Unrestricted Resource Consumption]
 */
const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const audioRef = useRef(null);
  /**
   * rateLimitedUntil: timestamp (ms) after which polling may resume.
   * When the backend returns 429, we double the normal poll interval before
   * retrying so a rate-limit spike does not kick off an infinite
   * login/dashboard redirect loop.
   * [API4:2023 - Unrestricted Resource Consumption]
   */
  const rateLimitedUntil = useRef(0);

  const bellSound = "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3";

  useEffect(() => {
    fetchNotifications();

    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    /**
     * [API4:2023 - Unrestricted Resource Consumption]
     * Skip the fetch if we are still inside a 429 back-off window.
     */
    if (Date.now() < rateLimitedUntil.current) return;

    try {
      const res = await getNotifications();
      const user = JSON.parse(localStorage.getItem("user") || "null");

      if (!user) return;

      const newNotifications = res.data;
      const count = newNotifications.filter(n => !n.readBy.includes(user._id)).length;

      if (count > unreadCount && unreadCount !== 0) {
        if (audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
      }

      setNotifications(newNotifications);
      setUnreadCount(count);
    } catch (err) {
      if (err?.response?.status === 429) {
        /**
         * [API4:2023 - Unrestricted Resource Consumption]
         * Back off for 2× the normal poll interval when rate-limited so
         * repeated retries do not exhaust the shared rate-limit budget and
         * prevent other critical calls (getMe, session checks) from succeeding.
         */
        rateLimitedUntil.current = Date.now() + POLL_INTERVAL_MS * 2;
      }
      if (process.env.NODE_ENV === "development" && err?.response?.status !== 401) {
        console.error("Notif fetch failed", err);
      }
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await markAsRead(id);
      fetchNotifications();
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Mark read failed", err);
      }
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case "warning": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "error": return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="relative">
      <audio ref={audioRef} src={bellSound} preload="auto" />
      
      <button 
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-olive-gray hover:text-near-black transition-colors"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-terracotta text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-parchment">
            {unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
          <div className="absolute right-0 mt-4 w-80 bg-white border border-border-cream rounded-3xl shadow-warm overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="p-4 border-b border-border-cream bg-warm-sand/5 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-stone-gray">Notifications</span>
              <Link href="/notifications" onClick={() => setShowDropdown(false)} className="text-[10px] text-terracotta font-bold hover:underline">View All</Link>
            </div>
            
            <div className="max-h-96 overflow-y-auto divide-y divide-border-cream">
              {notifications
                .filter(n => {
                  const user = JSON.parse(localStorage.getItem("user") || "null");
                  return user && !n.readBy.includes(user._id);
                })
                .slice(0, 5) // Clean cap for header dropdown
                .map((notif) => (
                  <div 
                    key={notif._id} 
                    className="p-4 transition-colors hover:bg-parchment/50 bg-terracotta/[0.01]"
                  >
                    <div className="flex gap-3">
                      <div className="mt-1 shrink-0">{getIcon(notif.type)}</div>
                      <div className="flex-grow">
                        <p className="text-sm font-semibold text-near-black tracking-tight">
                          {notif.title}
                        </p>
                        <p className="text-xs text-stone-gray mt-1 leading-relaxed line-clamp-2">{notif.message}</p>
                        <div className="flex items-center justify-between mt-3">
                           <span className="text-[9px] text-stone-gray font-serif italic">
                             {new Date(notif.createdAt).toLocaleDateString()}
                           </span>
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               handleMarkRead(notif._id);
                             }}
                             className="text-[10px] font-bold text-terracotta uppercase hover:underline"
                           >
                             Done
                           </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              
              {notifications.filter(n => {
                const user = JSON.parse(localStorage.getItem("user") || "null");
                return user && !n.readBy.includes(user._id);
              }).length === 0 && (
                <div className="p-12 text-center">
                  <p className="text-xs text-stone-gray italic">No new mission alerts.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

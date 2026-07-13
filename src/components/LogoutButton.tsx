"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button className="btn ghost" onClick={logout} style={{ padding: "6px 10px" }}>
      Log out
    </button>
  );
}

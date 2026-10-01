"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { galleryApi } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await galleryApi.login(username, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 bg-[radial-gradient(ellipse_at_top,_#1d2838,_#0b0d10)]">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-900/80 p-8 shadow-2xl backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-300/80">Private</p>
        <h1 className="mt-2 text-2xl font-semibold">Personal Gallery</h1>
        <p className="mt-1 text-sm text-zinc-400">Masuk untuk mengelola foto dan video di server Anda.</p>
        <label className="mt-6 block text-sm text-zinc-300">
          Username
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 outline-none focus:border-blue-400"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="mt-4 block text-sm text-zinc-300">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 outline-none focus:border-blue-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-blue-500 py-2.5 font-medium text-white hover:bg-blue-400 disabled:opacity-60"
        >
          {loading ? "Masuk..." : "Masuk"}
        </button>
        <p className="mt-4 text-xs text-zinc-500">Passkey / WebAuthn akan tersedia di V2. Login V1 memakai username dan password.</p>
      </form>
    </main>
  );
}

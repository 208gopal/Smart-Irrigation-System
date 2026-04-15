import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";

export default function LoginSignupPage({ mode, onAuth }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };
      const { data } = await api.post(endpoint, payload);
      onAuth(data);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to authenticate");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-[#fdfbf6] via-[#f9f5ef] to-[#f5efe6] px-4">
      <div className="w-full max-w-md bg-[#fffdf8]/95 backdrop-blur-xl border border-stone-200 rounded-2xl shadow-2xl p-8 text-slate-800">
        
        {/* Title */}
        <h2 className="text-3xl font-bold text-center mb-2">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h2>

        <p className="text-center text-slate-600 mb-6 text-sm">
          {mode === "login"
            ? "Login to access your smart irrigation dashboard"
            : "Sign up to start monitoring your farm"}
        </p>

        {/* Form */}
        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <input
              className="px-4 py-3 rounded-lg bg-white border border-stone-300 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          )}

          <input
            type="email"
            className="px-4 py-3 rounded-lg bg-white border border-stone-300 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
          />

          <input
            type="password"
            className="px-4 py-3 rounded-lg bg-white border border-stone-300 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            required
          />

          {error && (
            <p className="text-rose-700 text-sm text-center">{error}</p>
          )}

          <button
            className="mt-2 bg-emerald-700 text-white hover:bg-emerald-800 transition py-3 rounded-lg font-semibold shadow-lg"
            type="submit"
          >
            {mode === "login" ? "Login" : "Sign Up"}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-slate-600 mt-6 text-sm">
          {mode === "login" ? "New user?" : "Already have an account?"}{" "}
          <Link
            to={mode === "login" ? "/signup" : "/login"}
            className="text-emerald-700 hover:underline"
          >
            {mode === "login" ? "Create one" : "Login"}
          </Link>
        </p>
      </div>
    </div>
  );
}
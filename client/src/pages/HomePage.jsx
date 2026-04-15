import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-[#fdfbf6] via-[#f9f5ef] to-[#f5efe6] text-slate-800 flex flex-col">
      {/* Navbar */}
      <nav className="flex justify-between items-center px-8 py-6">
        <h1 className="text-2xl font-bold tracking-wide">🌿 Smart Irrigation</h1>
        <div className="flex items-center gap-6">
          <Link to="/login" className="text-slate-600 hover:text-slate-800 transition">
            Login
          </Link>
          <Link
            to="/signup"
            className="px-5 py-2 bg-emerald-700 text-white rounded-full hover:bg-emerald-800 transition shadow-lg"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-4xl">
          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight">
            Future of Farming
            <span className="block text-emerald-700">Starts Here</span>
          </h1>

          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
            Control irrigation, monitor sensors, and boost productivity with a smart IoT-powered system built for modern agriculture.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/login"
              className="px-8 py-4 text-lg font-semibold bg-emerald-700 text-white rounded-xl hover:bg-emerald-800 transition shadow-xl"
            >
              Get Started
            </Link>

            <Link
              to="/signup"
              className="px-8 py-4 text-lg font-semibold border border-stone-300 rounded-xl hover:bg-white transition"
            >
              Create Account
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="py-20 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">

          <div className="p-6 rounded-2xl bg-[#fffdf8]/90 border border-stone-200 backdrop-blur-md hover:scale-105 transition shadow-sm">
            <div className="text-4xl mb-4">🌱</div>
            <h3 className="text-xl font-semibold">Live Monitoring</h3>
            <p className="text-slate-600 mt-2">
              Track soil moisture, humidity, and temperature in real-time.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#fffdf8]/90 border border-stone-200 backdrop-blur-md hover:scale-105 transition shadow-sm">
            <div className="text-4xl mb-4">💧</div>
            <h3 className="text-xl font-semibold">Smart Irrigation</h3>
            <p className="text-slate-600 mt-2">
              Automate water flow and reduce wastage with intelligent control.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#fffdf8]/90 border border-stone-200 backdrop-blur-md hover:scale-105 transition shadow-sm">
            <div className="text-4xl mb-4">🤖</div>
            <h3 className="text-xl font-semibold">AI Insights</h3>
            <p className="text-slate-600 mt-2">
              Get smart crop recommendations powered by machine learning.
            </p>
          </div>

        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-6 text-slate-500 text-sm">
        © {new Date().getFullYear()} Smart Irrigation • Built for the future 🚀
      </footer>
    </div>
  );
}
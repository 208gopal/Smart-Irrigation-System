import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import HomePage from "./pages/HomePage";
import LoginSignupPage from "./pages/LoginSignupPage";
import DashboardPage from "./pages/DashboardPage";

function PrivateRoute({ isAuthed, children }) {
  return isAuthed ? children : <Navigate to="/login" replace />;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(
    localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user")) : null
  );

  const onAuth = ({ token: nextToken, user: nextUser }) => {
    localStorage.setItem("token", nextToken);
    localStorage.setItem("user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const onLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  };

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/login"
          element={token ? <Navigate to="/dashboard" replace /> : <LoginSignupPage mode="login" onAuth={onAuth} />}
        />
        <Route
          path="/signup"
          element={token ? <Navigate to="/dashboard" replace /> : <LoginSignupPage mode="signup" onAuth={onAuth} />}
        />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute isAuthed={Boolean(token)}>
              <DashboardPage user={user} onLogout={onLogout} />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;

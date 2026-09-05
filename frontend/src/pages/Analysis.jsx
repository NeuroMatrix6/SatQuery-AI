import { useNavigate } from "react-router-dom";

export default function Analysis() {
  const navigate = useNavigate();

  const features = [
    {
      icon: "🖼️",
      title: "Image Analysis",
      description:
        "Upload satellite imagery and ask AI questions about what is visible in the scene.",
      tag: "1 IMAGE",
      color: "blue",
      path: "/analysis/image",
    },
    {
      icon: "🔄",
      title: "Change Detection",
      description:
        "Compare satellite images from different dates and identify meaningful changes.",
      tag: "2 IMAGES",
      color: "purple",
      path: "/analysis/change",
    },
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-white">

      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[5%] top-[-150px] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[160px]" />

        <div className="absolute right-[-100px] top-[35%] h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[170px]" />

        <div className="absolute bottom-[-200px] left-[35%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[150px]" />
      </div>

      {/* NAVBAR */}
      <nav className="relative z-20 flex items-center justify-between border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">

        {/* LOGO */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <div className="text-3xl">
            🛰️
          </div>

          <div>
            <h1 className="text-xl font-semibold">
              SatQuery AI
            </h1>

            <p className="text-[10px] uppercase tracking-[0.25em] text-blue-400">
              Satellite Intelligence
            </p>
          </div>
        </button>

        {/* NAVIGATION */}
        <div className="hidden items-center gap-8 text-sm text-gray-400 md:flex">

          <button
            onClick={() => navigate("/")}
            className="transition hover:text-white"
          >
            Dashboard
          </button>

          <button
            onClick={() => navigate("/analysis")}
            className="text-blue-400"
          >
            Analysis
          </button>

        </div>
      </nav>

      {/* MAIN */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-16">

        {/* HEADER */}
        <div className="mx-auto max-w-3xl text-center">

          <div className="mb-5 flex items-center justify-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />

            <p className="text-xs uppercase tracking-[0.35em] text-blue-400">
              AI Analysis Workspace
            </p>
          </div>

          <h2 className="text-4xl font-bold tracking-tight md:text-6xl">
            What do you want to

            <span className="block text-blue-400">
              analyze?
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-gray-400 md:text-lg">
            Choose an analysis tool to explore satellite imagery,
            understand what is visible, and detect changes with AI.
          </p>

        </div>

        {/* FEATURE GRID */}
        <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">

          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              onClick={() => navigate(feature.path)}
            />
          ))}

        </div>

      </main>
    </div>
  );
}


/* =========================================================
   FEATURE CARD
========================================================= */

function FeatureCard({ feature, onClick }) {

  const colorClasses = {

    blue: {
      icon: "bg-blue-500/10 border-blue-400/20",
      glow: "bg-blue-500/10",
      text: "text-blue-400",
      border: "hover:border-blue-400/40",
    },

    purple: {
      icon: "bg-purple-500/10 border-purple-400/20",
      glow: "bg-purple-500/10",
      text: "text-purple-400",
      border: "hover:border-purple-400/40",
    },

  };

  const colors = colorClasses[feature.color];

  return (
    <button
      onClick={onClick}
      className={`
        group relative overflow-hidden
        rounded-3xl border border-white/10
        bg-white/[0.03] p-7
        text-left backdrop-blur-xl
        transition-all duration-300
        hover:-translate-y-1
        hover:bg-white/[0.06]
        ${colors.border}
      `}
    >

      {/* Glow */}
      <div
        className={`
          pointer-events-none absolute
          -right-20 -top-20
          h-48 w-48
          rounded-full blur-3xl
          opacity-0
          transition duration-500
          group-hover:opacity-100
          ${colors.glow}
        `}
      />

      {/* Top Row */}
      <div className="relative flex items-start justify-between">

        <div
          className={`
            flex h-14 w-14
            items-center justify-center
            rounded-2xl border text-2xl
            ${colors.icon}
          `}
        >
          {feature.icon}
        </div>

        <span
          className="
            rounded-full border
            border-white/10 bg-black/30
            px-3 py-1.5
            text-[10px]
            font-medium tracking-wider
            text-gray-500
          "
        >
          {feature.tag}
        </span>

      </div>

      {/* Content */}
      <div className="relative mt-7">

        <h3 className="text-xl font-semibold">
          {feature.title}
        </h3>

        <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
          {feature.description}
        </p>

      </div>

      {/* Bottom */}
      <div
        className={`
          relative mt-7 flex items-center
          gap-2 text-sm font-medium
          ${colors.text}
        `}
      >
        Open Analysis

        <span
          className="
            transition-transform
            duration-300
            group-hover:translate-x-1
          "
        >
          →
        </span>
      </div>

    </button>
  );
}
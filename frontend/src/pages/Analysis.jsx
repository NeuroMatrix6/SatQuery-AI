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

    {
      icon: "🌱",
      title: "Land Analysis",
      description:
        "Understand vegetation, buildings, roads, water bodies and land characteristics.",
      tag: "IMAGE + AI",
      color: "green",
      path: "/analysis/land",
    },

    {
      icon: "🗺️",
      title: "Geo Intelligence",
      description:
        "Explore geographic locations with maps, satellite context and AI assistance.",
      tag: "MAP + AI",
      color: "cyan",
      path: "/analysis/geo",
    },
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-white">

      {/* =====================================================
          BACKGROUND
      ====================================================== */}

      <div className="pointer-events-none fixed inset-0 overflow-hidden">

        <div className="absolute left-[5%] top-[-150px] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[160px]" />

        <div className="absolute right-[-100px] top-[35%] h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[170px]" />

        <div className="absolute bottom-[-200px] left-[35%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[150px]" />

      </div>


      {/* =====================================================
          NAVBAR
      ====================================================== */}

      <nav className="relative z-20 flex items-center justify-between border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">

        {/* Logo */}

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


        {/* Navigation */}

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

          <button
            className="transition hover:text-white"
          >
            History
          </button>

          <button
            className="transition hover:text-white"
          >
            About
          </button>

          <button
            className="
              rounded-lg border border-white/10
              bg-white/5 px-4 py-2
              transition hover:bg-white/10
            "
          >
            Settings
          </button>

        </div>

      </nav>


      {/* =====================================================
          MAIN
      ====================================================== */}

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
            detect changes, understand land features, or investigate
            geographic locations with AI.

          </p>

        </div>


        {/* =====================================================
            FEATURE GRID
        ====================================================== */}

        <div className="mt-14 grid gap-5 md:grid-cols-2">

          {features.map((feature) => (

            <FeatureCard
              key={feature.title}
              feature={feature}
              onClick={() => navigate(feature.path)}
            />

          ))}

        </div>


        {/* =====================================================
            AI INFORMATION
        ====================================================== */}

        <div className="mt-8 rounded-3xl border border-blue-500/20 bg-gradient-to-r from-blue-500/[0.08] via-purple-500/[0.04] to-transparent p-6 backdrop-blur-xl">

          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">

            <div className="flex items-start gap-4">

              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-xl">
                ✦
              </div>

              <div>

                <h3 className="font-semibold">
                  AI is available across every analysis
                </h3>

                <p className="mt-1 max-w-xl text-sm leading-6 text-gray-500">

                  Upload your data, explore the results and ask
                  natural-language questions whenever you need help
                  understanding the satellite information.

                </p>

              </div>

            </div>


            <div className="shrink-0 rounded-full border border-green-400/20 bg-green-400/10 px-4 py-2 text-xs text-green-400">

              ● AI READY

            </div>

          </div>

        </div>


        {/* =====================================================
            FOOTER
        ====================================================== */}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600">

          <p>
            SatQuery AI • Intelligent Earth Observation
          </p>

          <div className="flex items-center gap-2">

            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />

            All systems operational

          </div>

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

    green: {
      icon: "bg-green-500/10 border-green-400/20",
      glow: "bg-green-500/10",
      text: "text-green-400",
      border: "hover:border-green-400/40",
    },

    cyan: {
      icon: "bg-cyan-500/10 border-cyan-400/20",
      glow: "bg-cyan-500/10",
      text: "text-cyan-400",
      border: "hover:border-cyan-400/40",
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


        <span className="
          rounded-full border
          border-white/10 bg-black/30
          px-3 py-1.5
          text-[10px]
          font-medium tracking-wider
          text-gray-500
        ">
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

        <span className="
          transition-transform
          duration-300
          group-hover:translate-x-1
        ">
          →
        </span>

      </div>

    </button>
  );
}
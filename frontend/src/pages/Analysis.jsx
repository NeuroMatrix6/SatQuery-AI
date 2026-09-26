import { useNavigate } from "react-router-dom";

export default function Analysis() {
  const navigate = useNavigate();

  const features = [
    {
      icon: "🖼️",
      title: "Image Analysis",
      description:
        "Upload satellite imagery and analyze what is visible in the scene.",
      tag: "1 IMAGE",
      path: "/analysis/image",
    },

    {
      icon: "🔄",
      title: "Change Detection",
      description:
        "Compare satellite images from different dates and identify changes.",
      tag: "2 IMAGES",
      path: "/analysis/change",
    },

    {
      icon: "📍",
      title: "Geo Location",
      description:
        "Select a geographic location and prepare it for satellite analysis.",
      tag: "MAP",
      path: "/analysis/geo",
    },
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-white">

      {/* =====================================================
          BACKGROUND
      ====================================================== */}

      <div className="pointer-events-none fixed inset-0 overflow-hidden">

        {/* Single Blue Glow */}
        <div
          className="
            absolute
            left-[15%]
            top-[-180px]
            h-[500px]
            w-[500px]
            rounded-full
            bg-blue-600/10
            blur-[170px]
          "
        />

        <div
          className="
            absolute
            right-[-150px]
            bottom-[-180px]
            h-[450px]
            w-[450px]
            rounded-full
            bg-blue-500/5
            blur-[160px]
          "
        />

      </div>


      {/* =====================================================
          NAVBAR
      ====================================================== */}

      <nav
        className="
          relative z-20
          flex items-center justify-between
          border-b border-white/10
          bg-black/30
          px-8 py-5
          backdrop-blur-xl
        "
      >

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

            <p
              className="
                text-[10px]
                uppercase
                tracking-[0.25em]
                text-blue-400
              "
            >
              Satellite Intelligence
            </p>

          </div>

        </button>


        {/* NAVIGATION */}

        <div
          className="
            hidden
            items-center
            gap-8
            text-sm
            text-gray-400
            md:flex
          "
        >

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


      {/* =====================================================
          MAIN
      ====================================================== */}

      <main
        className="
          relative z-10
          mx-auto
          max-w-6xl
          px-6
          py-16
        "
      >

        {/* ===================================================
            HEADER
        ==================================================== */}

        <div className="mx-auto max-w-3xl text-center">

          {/* Small Label */}

          <div className="mb-5 flex items-center justify-center gap-2">

            <span
              className="
                h-2
                w-2
                rounded-full
                bg-blue-400
              "
            />

            <p
              className="
                text-xs
                uppercase
                tracking-[0.35em]
                text-blue-400
              "
            >
              Satellite Analysis Workspace
            </p>

          </div>


          {/* Main Heading */}

          <h2
            className="
              text-4xl
              font-bold
              tracking-tight
              md:text-6xl
            "
          >
            Choose Your

            <span className="block text-blue-400">
              Analysis
            </span>

          </h2>


          {/* Description */}

          <p
            className="
              mx-auto
              mt-6
              max-w-2xl
              text-base
              leading-7
              text-gray-400
              md:text-lg
            "
          >
            Select a satellite analysis workflow to begin.
          </p>

        </div>


        {/* ===================================================
            FEATURE GRID
        ==================================================== */}

        <div
          className="
            mx-auto
            mt-14
            grid
            max-w-6xl
            gap-5
            md:grid-cols-2
            lg:grid-cols-3
          "
        >

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

function FeatureCard({
  feature,
  onClick,
}) {

  return (
    <button
      onClick={onClick}
      className="
        group
        relative
        w-full
        overflow-hidden
        rounded-3xl
        border
        border-white/10
        bg-white/[0.03]
        p-7
        text-left
        backdrop-blur-xl
        transition-all
        duration-300

        hover:-translate-y-1
        hover:border-blue-400/40
        hover:bg-white/[0.05]
        hover:shadow-[0_15px_45px_rgba(37,99,235,0.10)]
      "
    >

      {/* =================================================
          BLUE HOVER GLOW
      ================================================== */}

      <div
        className="
          pointer-events-none
          absolute
          -right-20
          -top-20
          h-48
          w-48
          rounded-full
          bg-blue-500/10
          blur-3xl
          opacity-0
          transition
          duration-500
          group-hover:opacity-100
        "
      />


      {/* =================================================
          TOP ROW
      ================================================== */}

      <div
        className="
          relative
          flex
          items-start
          justify-between
        "
      >

        {/* ICON */}

        <div
          className="
            flex
            h-14
            w-14
            items-center
            justify-center
            rounded-2xl
            border
            border-blue-400/20
            bg-blue-500/10
            text-2xl
          "
        >
          {feature.icon}
        </div>


        {/* TAG */}

        <span
          className="
            rounded-full
            border
            border-white/10
            bg-black/30
            px-3
            py-1.5
            text-[10px]
            font-medium
            tracking-wider
            text-gray-500
          "
        >
          {feature.tag}
        </span>

      </div>


      {/* =================================================
          CONTENT
      ================================================== */}

      <div className="relative mt-7">

        <h3 className="text-xl font-semibold">
          {feature.title}
        </h3>

        <p
          className="
            mt-3
            min-h-[72px]
            max-w-md
            text-sm
            leading-6
            text-gray-500
          "
        >
          {feature.description}
        </p>

      </div>


      {/* =================================================
          ACTION
      ================================================== */}

      <div
        className="
          relative
          mt-7
          flex
          items-center
          gap-2
          text-sm
          font-medium
          text-blue-400
        "
      >

        {feature.title === "Geo Location"
          ? "Select Location"
          : "Start Analysis"}

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
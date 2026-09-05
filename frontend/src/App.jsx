import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

import EarthScene from "./components/EarthScene";
import Analysis from "./pages/Analysis";
import ImageAnalysis from "./pages/ImageAnalysis";
import ChangeDetection from "./pages/ChangeDetection";


/* =========================================================
   LANDING PAGE
========================================================= */

function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">

      {/* =====================================================
          3D EARTH + SATELLITE BACKGROUND
      ====================================================== */}

      <EarthScene />

      {/* Dark overlay */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-black/20" />


      {/* =====================================================
          NAVIGATION
      ====================================================== */}

      <nav className="relative z-10 flex items-center justify-between px-10 py-6">

        {/* LOGO */}

        <Link to="/" className="text-left">

          <h1 className="text-2xl font-semibold">
            🛰️ SatQuery AI
          </h1>

          <p className="mt-1 text-[9px] uppercase tracking-[0.3em] text-blue-400">
            Satellite Intelligence
          </p>

        </Link>


        {/* MENU */}

        <div className="flex gap-8 text-sm text-gray-300">

          <Link
            to="/"
            className="transition hover:text-white"
          >
            Home
          </Link>

          <Link
            to="/analysis"
            className="transition hover:text-white"
          >
            New Analysis
          </Link>

        </div>

      </nav>


      {/* =====================================================
          HERO SECTION
      ====================================================== */}

      <main className="relative z-10 flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">

        {/* Small heading */}

        <p className="mb-5 text-sm uppercase tracking-[0.3em] text-blue-400">
          AI-Powered Satellite Intelligence
        </p>


        {/* Main heading */}

        <h2 className="max-w-5xl text-5xl font-bold leading-tight md:text-7xl">

          Understand Satellite Data

          <span className="block text-blue-400">
            With AI
          </span>

        </h2>


        {/* Description */}

        <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-300">

          Ask questions about satellite imagery,
          detect changes between observations,
          and understand Earth scenes using intelligent AI tools.

        </p>


        {/* ===================================================
            START ANALYSIS BUTTON
        ==================================================== */}

        <Link
          to="/analysis"
          className="
            group
            mt-10
            rounded-full
            bg-blue-500
            px-8
            py-4
            font-semibold
            shadow-xl
            shadow-blue-500/20
            transition
            duration-300
            hover:scale-105
            hover:bg-blue-400
            hover:shadow-blue-500/40
          "
        >

          Start New Analysis

          <span className="ml-2 inline-block transition group-hover:translate-x-1">
            →
          </span>

        </Link>


        {/* ===================================================
            WORKING FEATURES
        ==================================================== */}

        <div className="mt-20 grid w-full max-w-4xl gap-5 md:grid-cols-2">

          {/* IMAGE UNDERSTANDING */}

          <Feature
            icon="🌍"
            title="Image Understanding"
            description="Upload satellite imagery and ask natural-language questions using AI."
            path="/analysis/image"
          />


          {/* CHANGE DETECTION */}

          <Feature
            icon="🔄"
            title="Change Detection"
            description="Compare satellite images from different dates and identify visual changes."
            path="/analysis/change"
          />

        </div>

      </main>

    </div>
  );
}


/* =========================================================
   CLICKABLE FEATURE CARD
========================================================= */

function Feature({
  icon,
  title,
  description,
  path,
}) {
  return (
    <Link
      to={path}
      className="
        group
        block
        rounded-2xl
        border
        border-white/10
        bg-white/[0.05]
        p-6
        text-left
        backdrop-blur-md
        transition
        duration-300
        hover:-translate-y-1
        hover:border-blue-400/30
        hover:bg-white/[0.09]
      "
    >

      {/* Icon */}

      <div className="mb-4 text-2xl">
        {icon}
      </div>


      {/* Title */}

      <h3 className="text-lg font-semibold">
        {title}
      </h3>


      {/* Description */}

      <p className="mt-3 text-sm leading-6 text-gray-400">
        {description}
      </p>


      {/* Open Analysis */}

      <div className="mt-5 text-sm font-medium text-blue-400">

        Open Analysis

        <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1">
          →
        </span>

      </div>

    </Link>
  );
}


/* =========================================================
   APP ROUTER
========================================================= */

function App() {

  return (

    <BrowserRouter>

      <Routes>

        {/* =================================================
            LANDING PAGE
        ================================================= */}

        <Route
          path="/"
          element={<Home />}
        />


        {/* =================================================
            ANALYSIS HUB
        ================================================= */}

        <Route
          path="/analysis"
          element={<Analysis />}
        />


        {/* =================================================
            IMAGE ANALYSIS
        ================================================= */}

        <Route
          path="/analysis/image"
          element={<ImageAnalysis />}
        />


        {/* =================================================
            CHANGE DETECTION
        ================================================= */}

        <Route
          path="/analysis/change"
          element={<ChangeDetection />}
        />

      </Routes>

    </BrowserRouter>

  );
}


export default App;
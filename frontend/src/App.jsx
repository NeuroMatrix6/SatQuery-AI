import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

import EarthScene from "./components/EarthScene";
import Analysis from "./pages/Analysis";
import ImageAnalysis from "./pages/ImageAnalysis";
import ChangeDetection from "./pages/ChangeDetection";
import GeoLocation from "./pages/GeoLocation";

function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">

      {/* 3D Earth + Satellite */}
      <EarthScene />

      {/* Dark overlay */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-black/20" />

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 md:px-12">
        <div>
          <h1 className="text-xl font-semibold tracking-wide md:text-2xl">
            🛰️ SatQuery AI
          </h1>

          <p className="mt-1 text-[8px] uppercase tracking-[0.35em] text-blue-400 md:text-[9px]">
            Satellite Intelligence
          </p>
        </div>

        <div className="text-xs uppercase tracking-[0.25em] text-gray-400">
          AI · EARTH · INTELLIGENCE
        </div>
      </nav>

      {/* Hero */}
      <main
        className="
          relative z-10
          flex min-h-[78vh]
          -translate-y-20
          items-center justify-center
          px-6 text-center
        "
      >
        <div className="max-w-5xl">

          {/* Small heading */}
          <p className="mb-5 text-xs font-medium uppercase tracking-[0.4em] text-blue-400 md:text-sm">
            AI-POWERED SATELLITE INTELLIGENCE
          </p>

          {/* Main heading */}
          <h2
            className="
              text-4xl
              font-bold
              leading-[1.05]
              tracking-tight
              md:text-5xl
              lg:text-6xl
            "
          >
            WELCOME TO

            <span className="block text-blue-400">
              SATQUERY AI
            </span>
          </h2>

          {/* Description */}
          <p
            className="
              mx-auto
              mt-6
              max-w-xl
              text-sm
              leading-6
              text-gray-300
              md:text-base
              md:leading-7
            "
          >
            Analyze satellite imagery, detect changes, and explore Earth
            observations through intelligent satellite analysis.
          </p>

          {/* ONLY BUTTON */}
          <div className="mt-8">
            <Link
              to="/analysis"
              className="
                inline-flex
                items-center
                gap-3
                rounded-full
                border
                border-blue-400/50
                bg-blue-500/10
                px-8
                py-4
                text-sm
                font-medium
                text-white
                backdrop-blur-md
                transition-all
                duration-300
                hover:border-blue-400
                hover:bg-blue-500/20
                hover:shadow-[0_0_35px_rgba(59,130,246,0.35)]
              "
            >
              Start Analysis
              <span className="text-lg">→</span>
            </Link>
          </div>

        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* Landing Page */}
        <Route path="/" element={<Home />} />

        {/* Main Analysis */}
        <Route path="/analysis" element={<Analysis />} />

        {/* Image Analysis */}
        <Route
          path="/analysis/image"
          element={<ImageAnalysis />}
        />

        {/* Change Detection */}
        <Route
          path="/analysis/change-detection"
          element={<ChangeDetection />}
        />

        {/* Alternate Change Detection */}
        <Route
          path="/analysis/change"
          element={<ChangeDetection />}
        />

        {/* Geo Location */}
        <Route
          path="/analysis/geo"
          element={<GeoLocation />}
        />

      </Routes>
    </BrowserRouter>
  );
}
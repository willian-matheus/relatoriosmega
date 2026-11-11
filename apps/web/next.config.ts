import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // pdf.js (conversão de extrato PDF -> OFX) roda no servidor sem ser empacotado
  serverExternalPackages: ["pdfjs-dist"],
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${process.env.API_URL || "http://127.0.0.1:3001"}/api/:path*`,
        },
      ],
    };
  },
};

export default config;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["firebase-admin", "@google-cloud/firestore"],
  poweredByHeader: false,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  images: {
    // Imagens de produtos vêm de CDNs de lojas (ex.: mlstatic.com). Liberamos apenas HTTPS.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    unoptimized: true,
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // Anti clickjacking por padrão. Exceção apenas para preview em iframe de ambiente
    // controlado (RADAR_ALLOW_PREVIEW_FRAME=1); nunca habilitar em produção.
    if (process.env.RADAR_ALLOW_PREVIEW_FRAME !== "1") {
      headers.unshift({ key: "X-Frame-Options", value: "DENY" });
    }
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;

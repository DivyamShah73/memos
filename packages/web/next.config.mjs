/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @memos/shared ships TS source (no build step), so Next must transpile it.
  transpilePackages: ["@memos/shared"],
};

export default nextConfig;

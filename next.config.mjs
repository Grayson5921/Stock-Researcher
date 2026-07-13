/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The BullMQ/ioredis/pg/stripe libraries are only used in server code (route
    // handlers + the worker). Keep them external so Next doesn't try to bundle
    // their native/optional deps into the server output. (Next 15 renames this
    // to top-level `serverExternalPackages`.)
    serverComponentsExternalPackages: ["bullmq", "ioredis", "pg", "stripe"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: [
		"sequelize",
		"mysql2",
		"@google/genai",
		"@aws-sdk/client-s3",
		"@aws-sdk/s3-request-presigner",
	],
};

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();

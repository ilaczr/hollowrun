import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import packageJson from './package.json' with { type: 'json' }
import { shouldUploadSourceMaps } from './src/build-config.js'

const releaseName = `hollowrun@${packageJson.version}`

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const uploadSourceMaps = shouldUploadSourceMaps(env)

  return {
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
    },
    plugins: [
      react(),
      ...(uploadSourceMaps ? [sentryVitePlugin({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        url: env.SENTRY_URL || undefined,
        telemetry: false,
        release: {
          name: releaseName,
          setCommits: {
            auto: true,
            ignoreMissing: true,
            ignoreEmpty: true,
          },
        },
        sourcemaps: {
          assets: './dist/**',
          filesToDeleteAfterUpload: './dist/**/*.map',
        },
      })] : []),
    ],
  }
})

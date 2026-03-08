/**
 * Extended webpack config: raises asset/entrypoint size limits so the
 * Three.js-based 3D panel bundle does not trigger performance warnings.
 */
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return merge(baseConfig, {
    performance: {
      // Three.js + postprocessing + controls make the bundle ~630 KiB; allow up to 768 KiB
      maxAssetSize: 768 * 1024,
      maxEntrypointSize: 768 * 1024,
    },
  });
};

export default config;

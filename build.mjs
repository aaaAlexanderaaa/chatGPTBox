import archiver from 'archiver'
import fs from 'fs-extra'
import path from 'path'
import webpack from 'webpack'
import ProgressBarPlugin from 'progress-bar-webpack-plugin'
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import TerserPlugin from 'terser-webpack-plugin'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'

const outdir = 'build'

const __dirname = path.resolve()
const args = process.argv.slice(2)
const isProduction = !args.includes('--development') // --production and --analyze are both production
const isAnalyzing = args.includes('--analyze')

async function deleteOldDir() {
  await fs.rm(outdir, { recursive: true, force: true })
}

async function runWebpack(isWithoutKatex, isWithoutTiktoken, minimal, callback) {
  const shared = [
    'preact',
    'webextension-polyfill',
    'countries-list',
    'i18next',
    'react-i18next',
    'react-tabs',
    './src/utils',
    './src/_locales/i18n-react',
  ]
  if (isWithoutKatex) shared.push('./src/components')

  const compiler = webpack({
    entry: {
      'content-script': {
        import: './src/content-script/index.jsx',
        dependOn: 'shared',
      },
      background: {
        import: './src/background/index.mjs',
      },
      popup: {
        import: './src/popup/index.jsx',
        dependOn: 'shared',
      },
      options: {
        import: './src/options/index.jsx',
        dependOn: 'shared',
      },
      IndependentPanel: {
        import: './src/pages/IndependentPanel/index.jsx',
        dependOn: 'shared',
      },
      ApiServer: {
        import: './src/pages/ApiServer/index.jsx',
        dependOn: 'shared',
      },
      dsh: {
        import: './src/modules/dsh/ui/index.jsx',
        dependOn: 'shared',
      },
      // Self-contained on purpose (no dependOn): it is injected as a lone
      // file into harness-origin tabs by downlink-bridge.mjs.
      'dsh-downlink': {
        import: './src/modules/dsh/content/downlink.mjs',
      },
      shared: shared,
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, outdir),
      publicPath: '',
    },
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? false : 'inline-source-map',
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            output: { ascii_only: true },
          },
        }),
        new CssMinimizerPlugin(),
      ],
      concatenateModules: !isAnalyzing,
    },
    plugins: [
      minimal
        ? new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
          })
        : new webpack.ProvidePlugin({
            process: 'process/browser.js',
            Buffer: ['buffer', 'Buffer'],
          }),
      new ProgressBarPlugin({
        format: '  build [:bar] :percent (:elapsed seconds)',
        clear: false,
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new BundleAnalyzerPlugin({
        analyzerMode: isAnalyzing ? 'static' : 'disable',
      }),
      ...(isWithoutKatex
        ? [
            new webpack.NormalModuleReplacementPlugin(/markdown\.jsx/, (result) => {
              if (result.request) {
                result.request = result.request.replace(
                  'markdown.jsx',
                  'markdown-without-katex.jsx',
                )
              }
            }),
          ]
        : []),
    ],
    resolve: {
      extensions: ['.jsx', '.mjs', '.js'],
      alias: {
        ...(minimal
          ? { buffer: path.resolve(__dirname, 'node_modules/buffer') }
          : {
              util: path.resolve(__dirname, 'node_modules/util'),
              buffer: path.resolve(__dirname, 'node_modules/buffer'),
            }),
      },
    },
    module: {
      rules: [
        {
          test: /\.m?jsx?$/,
          exclude: /(node_modules)/,
          resolve: {
            fullySpecified: false,
          },
          use: [
            {
              loader: 'babel-loader',
              options: {
                presets: [
                  '@babel/preset-env',
                  {
                    plugins: ['@babel/plugin-transform-runtime'],
                  },
                ],
                plugins: [
                  [
                    '@babel/plugin-transform-react-jsx',
                    {
                      runtime: 'automatic',
                      importSource: 'preact',
                    },
                  ],
                ],
              },
            },
          ],
        },
        {
          test: /\.s[ac]ss$/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                importLoaders: 1,
              },
            },
            {
              loader: 'sass-loader',
            },
          ],
        },
        {
          test: /\.less$/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                importLoaders: 1,
              },
            },
            {
              loader: 'less-loader',
            },
          ],
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                importLoaders: 1,
              },
            },
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: ['tailwindcss', 'autoprefixer'],
                },
              },
            },
          ],
        },
        {
          test: /\.(woff|ttf)$/,
          type: 'asset/resource',
          generator: {
            emit: false,
          },
        },
        {
          test: /\.woff2$/,
          type: 'asset/inline',
        },
        {
          test: /\.(jpg|png|svg)$/,
          type: 'asset/inline',
        },
        isWithoutTiktoken
          ? {
              test: /crop-text\.mjs$/,
              loader: 'string-replace-loader',
              options: {
                multiple: [
                  {
                    search: "import { encode } from '@nem035/gpt-3-encoder'",
                    replace: '',
                  },
                  {
                    search: 'encode(',
                    replace: 'String(',
                  },
                ],
              },
            }
          : {},
        minimal
          ? {
              test: /index\.mjs$/,
              loader: 'string-replace-loader',
              options: {
                multiple: [
                  {
                    search: 'import { generateAnswersWithChatGLMApi }',
                    replace: '//',
                  },
                  {
                    search: 'await generateAnswersWithChatGLMApi',
                    replace: '//',
                  },
                ],
              },
            }
          : {},
      ],
    },
  })
  if (!isProduction) {
    compiler.watch({}, callback)
    return
  }

  // Awaited so a production build finishes (or fails) before the next pass starts.
  try {
    const [err, stats] = await new Promise((resolve) => {
      compiler.run((runErr, runStats) => resolve([runErr, runStats]))
    })
    await callback(err, stats)
  } finally {
    await new Promise((resolve) => compiler.close(resolve))
  }
}

async function zipFolder(dir) {
  const output = fs.createWriteStream(`${dir}.zip`)
  const archive = archiver('zip', {
    zlib: { level: 9 },
  })
  archive.pipe(output)
  archive.directory(dir, false)
  await archive.finalize()
}

async function copyFiles(entryPoints, targetDir) {
  if (!fs.existsSync(targetDir)) await fs.mkdir(targetDir)
  await Promise.all(
    entryPoints.map(async (entryPoint) => {
      await fs.copy(entryPoint.src, `${targetDir}/${entryPoint.dst}`)
    }),
  )
}

async function finishOutput(outputDirSuffix) {
  const commonFiles = [
    { src: 'LICENSE', dst: 'LICENSE' },
    { src: 'src/logo.png', dst: 'logo.png' },
    { src: 'src/rules.json', dst: 'rules.json' },

    { src: 'build/shared.js', dst: 'shared.js' },
    { src: 'build/content-script.css', dst: 'content-script.css' }, // shared

    { src: 'build/content-script.js', dst: 'content-script.js' },

    { src: 'build/background.js', dst: 'background.js' },

    { src: 'build/popup.js', dst: 'popup.js' },
    { src: 'build/popup.css', dst: 'popup.css' },
    { src: 'src/popup/index.html', dst: 'popup.html' },

    { src: 'build/options.js', dst: 'options.js' },
    { src: 'build/options.css', dst: 'options.css' },
    { src: 'src/options/index.html', dst: 'options.html' },

    { src: 'build/IndependentPanel.js', dst: 'IndependentPanel.js' },
    { src: 'build/IndependentPanel.css', dst: 'IndependentPanel.css' },
    { src: 'src/pages/IndependentPanel/index.html', dst: 'IndependentPanel.html' },

    { src: 'build/ApiServer.js', dst: 'ApiServer.js' },
    { src: 'build/ApiServer.css', dst: 'ApiServer.css' },
    { src: 'src/pages/ApiServer/index.html', dst: 'ApiServer.html' },

    { src: 'build/dsh.js', dst: 'dsh.js' },
    { src: 'build/dsh.css', dst: 'tokens.css' },
    { src: 'src/modules/dsh/ui/index.html', dst: 'dsh.html' },

    { src: 'build/dsh-downlink.js', dst: 'dsh-downlink.js' },
  ]

  // chromium
  const chromiumOutputDir = `./${outdir}/chromium${outputDirSuffix}`
  await copyFiles(
    [...commonFiles, { src: 'src/manifest.json', dst: 'manifest.json' }],
    chromiumOutputDir,
  )
  if (isProduction) await zipFolder(chromiumOutputDir)

  // firefox
  const firefoxOutputDir = `./${outdir}/firefox${outputDirSuffix}`
  await copyFiles(
    [...commonFiles, { src: 'src/manifest.v2.json', dst: 'manifest.json' }],
    firefoxOutputDir,
  )
  if (isProduction) await zipFolder(firefoxOutputDir)
}

function generateWebpackCallback(finishOutputFunc) {
  return async function webpackCallback(err, stats) {
    if (err || stats.hasErrors()) {
      console.error(err || stats.toString())
      // A one-shot build must fail the process so CI does not go green on a
      // bundle that never compiled. Watch mode keeps running and retries.
      if (isProduction) throw new Error('webpack compilation failed')
      return
    }
    // console.log(stats.toString())

    await finishOutputFunc()
  }
}

async function build() {
  const { syncProtocolReference } = await import('./scripts/sync-protocol-reference.mjs')
  syncProtocolReference()
  await deleteOldDir()
  if (isProduction && !isAnalyzing) {
    // await runWebpack(
    //   true,
    //   false,
    //   generateWebpackCallback(() => finishOutput('-without-katex')),
    // )
    // await new Promise((r) => setTimeout(r, 5000))
    await runWebpack(
      true,
      true,
      true,
      generateWebpackCallback(() => finishOutput('-without-katex-and-tiktoken')),
    )
  }
  await runWebpack(
    false,
    false,
    false,
    generateWebpackCallback(() => finishOutput('')),
  )
}

build().catch((error) => {
  console.error(error?.message || error)
  process.exitCode = 1
})

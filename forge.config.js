const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  outDir: './build-output',
  packagerConfig: {
    asar: true,
    out: './build-output',
    icon: './assets/icon', // Add icon files: icon.ico (Windows), icon.icns (macOS), icon.png (Linux)
    appBundleId: 'io.urtextpiano.app',
    appCategoryType: 'public.app-category.music',
    win32metadata: {
      CompanyName: 'Urtext Piano',
      FileDescription: 'Professional piano practice with real sheet music',
      OriginalFilename: 'Urtext Piano.exe',
      ProductName: 'Urtext Piano',
      InternalName: 'urtext-piano'
    },
    ignore: [
      /\.ts$/,              // Exclude TypeScript source files
      /\.tsx$/,             // Exclude TypeScript React files
      /tsconfig\.json$/,    // Exclude TypeScript config
      /\.map$/,             // Exclude source maps
      /^\/test/,            // Exclude test directories
      /^\/docs/,            // Exclude documentation
      /^\/\.vscode/,        // Exclude VS Code config
      /^\/\.git/            // Exclude git directory
    ]
  },
  rebuildConfig: {
    onlyModules: [] // Don't rebuild any native modules
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'UrtextPiano',
        setupExe: 'Urtext Piano Setup ${version}.exe',
        setupIcon: './assets/icon.ico',
        loadingGif: './assets/installer.gif' // Optional: add animated installer graphic
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'], // Now creates zip files for both Mac and Windows
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Urtext Piano Team',
          homepage: 'https://urtextpiano.io',
          categories: ['Audio', 'Music', 'Education'],
          description: 'Professional piano practice app with real sheet music'
        }
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    // Temporarily disable auto-unpack-natives to fix hanging build
    // {
    //   name: '@electron-forge/plugin-auto-unpack-natives',
    //   config: {},
    // },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

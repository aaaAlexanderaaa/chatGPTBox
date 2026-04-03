# Contributing to chatGPTBox

Thank you for your interest in contributing to chatGPTBox! This project aims to bring the power of AI to your browser in the most convenient way possible.

## Project Overview

chatGPTBox is a browser extension built with modern web technologies:
- **Frontend Framework**: [Preact](https://preactjs.com/) (a fast 3kB alternative to React with the same ES6 API)
- **Build System**: [Webpack 5](https://webpack.js.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Platform Support**: Manifest V3 (Chrome/Edge), Manifest V2 (Firefox), and Safari.

The core architecture focuses on modularity, allowing easy integration of different AI models and search engine enhancements.

## Development Setup

To get started with development:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/aaaAlexanderaaa/chatGPTBox.git
    cd chatGPTBox
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Build the extension**:
    ```bash
    # For development (with source maps and watching)
    npm run dev

    # For a production build
    npm run build
    ```

4.  **Load the unpacked extension**:
    - **Chrome/Edge**: Go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked", and select the `build/chromium` directory.
    - **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select the `build/firefox/manifest.json` file.
    - **Safari**: See the [Safari build instructions](https://github.com/aaaAlexanderaaa/chatGPTBox/blob/master/safari/README.md).

## Code Style

We follow existing patterns in the codebase to maintain consistency:
- **Utility Library**: Use [lodash-es](https://lodash.com/) for common utility functions.
- **Browser APIs**: Use [webextension-polyfill](https://github.com/mozilla/webextension-polyfill) for cross-browser compatibility.
- **Modules**: Use ESM (EcmaScript Modules) syntax throughout the project.
- **Styling**: Use Tailwind CSS classes for styling components.

Please run `npm run pretty` before committing to ensure consistent formatting.

## PR Process

1.  **Fork** the repository and create your branch from `master`.
2.  **Test** your changes thoroughly in supported browsers.
3.  **Submit a Pull Request** with a clear description of the changes and link to any related issues.
4.  Ensure that the CI tests pass.

## Issue Triage Labels

- `bug`: Something isn't working as expected.
- `feature`: New functionality or enhancement.
- `refactor`: Code changes that neither fix a bug nor add a feature.
- `documentation`: Improvements to documentation.
- `help wanted`: Tasks that are open for community contribution.

## Additional Information

For more detailed technical documentation and contribution guidelines, please refer to our [Wiki](https://github.com/aaaAlexanderaaa/chatGPTBox/wiki/Development&Contributing).

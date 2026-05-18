module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Required so zod v4's `export * as ... from` syntax transpiles cleanly.
    '@babel/plugin-transform-export-namespace-from',
  ],
};

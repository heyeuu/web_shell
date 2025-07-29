// const { default: tailwindcss } = require("@tailwindcss/vite");
// const { plugin } = require("alpinejs");
// const autoprefixer = require("autoprefixer");
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

export default {
    plugins: {
        '@tailwindcss/postcss': {},
        autoprefixer: {},
    },
};

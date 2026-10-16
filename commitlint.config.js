/** @type {import("@commitlint/types").UserConfig} */
const config = {
	extends: ['@commitlint/config-conventional'],
	rules: {
		'subject-case': [2, 'always', 'lower-case'],
		'body-max-line-length': [2, 'always', 72],
		'footer-max-line-length': [0],
	},
};

export default config;

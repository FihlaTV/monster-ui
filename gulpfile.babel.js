import gulp from 'gulp';
import { create } from 'browser-sync';
import require from './gulp/tasks/require.js';
import writeVersion from './gulp/tasks/write-version.js';
import { lint, minifyJs, minifyJsApp } from './gulp/tasks/javascript.js';
import { templates, templatesApp } from './gulp/tasks/templates.js';
import { compileSass, css, minifyCssApp } from './gulp/tasks/style.js';
import {
	writeConfigProd,
	writeConfigDev,
	writeConfigApp
} from './gulp/tasks/write-config.js';
import {
	cleanFolders,
	moveDistDev,
	moveFilesToTmp
} from './gulp/tasks/clean-move.js';
import watchSources from './gulp/tasks/watch-sources'

const server = create();

const serve = done => {
	server.init({
		server: {
			baseDir: './dist'
		}
	});
	done();
}

const watch = done => {
	watchSources(server);
	done();
}

const buildProd = gulp.series(
	moveFilesToTmp,
	compileSass,
	templates,
	require,
	minifyJs,
	css,
	writeConfigProd,
	writeVersion,
	cleanFolders
);

const buildDev = gulp.series(
	moveFilesToTmp,
	// lint,
	compileSass,
	writeConfigDev,
	writeVersion,
	cleanFolders
);

const buildApp = gulp.series(
	moveFilesToTmp,
	compileSass,
	templatesApp,
	require,
	minifyJsApp,
	minifyCssApp,
	writeConfigApp,
	cleanFolders
);

gulp.task('build-app', buildApp);

gulp.task('build-dev', buildDev);
gulp.task('serve-dev', gulp.series(buildDev, serve, watch));

gulp.task('build-prod', buildProd);
gulp.task('serve-prod', gulp.series(buildProd, serve));

gulp.task('build-all', gulp.series(buildDev, moveDistDev, buildProd));

export default gulp.series('serve-dev');
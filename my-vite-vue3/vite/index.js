//vite/index.js
const fs = require('fs').promises
const Koa = require('koa')
const path = require('path')
const chalk = require('chalk')
const static = require('koa-static')
const { parse } = require('es-module-lexer')
const MagicString = require('magic-string')
const { Readable } = require('stream')

//读取body方法
async function readBody(stream) {
	if (stream instanceof Readable) {
		return new Promise((resolve) => {
			let res = ''
			stream.on('data', function (chunk) {
				res += chunk
			});
			stream.on('end', function () {
				resolve(res)
			})
		})
	} else {
		return stream;
	}
}

//koa中间件
const resolvePlugin = [
	// 1. 重写引入模块路径前面加上/@modules/vue, 重写后浏览器会再次发送请求
	({ app, root }) => {
		function rewriteImports(source) {
			let imports = parse(source)[0];
			let ms = new MagicString(source);
			if (imports.length > 0) {
				for (let i = 0; i < imports.length; i++) {
					let { s, e } = imports[i];
					let id = source.slice(s, e); // 应用的标识 vue  ./App.vue
					// 不是./ 或者 /
					if (/^[^\/\.]/.test(id)) {
						id = `/@modules/${id}`;
						ms.overwrite(s, e, id)
					}
				}
			}
			return ms.toString();
		}
		app.use(async (ctx, next) => {
			await next(); // 静态服务
			// 默认会先执行 静态服务中间件 会将结果放到 ctx.body
			// 需要将流转换成字符串 , 只需要处理js中的引用问题
			if (ctx.body && ctx.response.is('js')) {
				let r = await readBody(ctx.body); // vue => /@modules
				const result = rewriteImports(r);
				ctx.body = result;
			}
		})
	},

	// 2. 拦截含有/@modules/vue的请求, 去node_modules引入对应的模块并返回
	({ app, root }) => {
		const reg = /^\/@modules\//
		app.use(async (ctx, next) => {
			// 如果没有匹配到 /@modules/vue 就往下执行即可
			if (!reg.test(ctx.path)) {
				return next();
			}
			const id = ctx.path.replace(reg, '');

			let mapping = {
				vue: path.resolve(root, 'node_modules', '@vue/runtime-dom/dist/runtime-dom.esm-browser.js'),
			}
			const content = await fs.readFile(mapping[id], 'utf8');
			ctx.type = 'js'; // 返回的文件是js
			ctx.body = content;
		})
	},

	// 3. 解析.vue文件
	({ app, root }) => {
		app.use(async (ctx, next) => {
			if (!ctx.path.endsWith('.vue')) {
				return next();
			}
			const filePath = path.join(root, ctx.path);
			const content = await fs.readFile(filePath, 'utf8');
			// 引入.vue文件解析模板
			const { compileTemplate, parse } = require(path.resolve(root, 'node_modules', '@vue/compiler-sfc/dist/compiler-sfc.cjs'))
			let { descriptor } = parse(content);
			if (!ctx.query.type) {
				//App.vue
				let code = ''
				if (descriptor.script) {
					let content = descriptor.script.content;
					code += content.replace(/((?:^|\n|;)\s*)export default/, '$1const __script=');
				}
				if (descriptor.template) {
					const requestPath = ctx.path + `?type=template`;
					code += `\nimport { render as __render } from "${requestPath}"`;
					code += `\n__script.render = __render`
				}
				code += `\nexport default __script`
				ctx.type = 'js';
				ctx.body = code
			}
			if (ctx.query.type == 'template') {
				ctx.type = 'js';
				let content = descriptor.template.content
				const { code } = compileTemplate({ source: content }); // 将app.vue中的模板 转换成render函数
				ctx.body = code;
			}
		})
	},

	// 4. 静态服务插件 实现可以返回文件的功能
	({ app, root }) => {
		app.use(static(root))
		app.use(static(path.resolve(root, 'public')))
	}
]

function createServer() {
	let app = new Koa()
    console.log(process.cwd() )
	const context = {     // 直接创建一个上下文 来给不同的插件共享功能
		app,
		root: process.cwd() // C:\Users\...\my-vite-vue3
	}

	// 运行中间件
	resolvePlugin.forEach(plugin => plugin(context))

	return app
}

createServer().listen(4000, () => {
	console.log(' Dev server running at:')
	console.log(` > Local: ${chalk.cyan('http://localhost:4000/')}`)
})
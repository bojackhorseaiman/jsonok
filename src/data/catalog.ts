// 工具目录：全站唯一的数据来源（导航、首页、搜索、静态页面生成都读这里）
// 纯数据，不依赖浏览器，vite.config.ts 构建时也会引用
import { CAT_ICON, TOOL_ICON } from './toolIcons';

export type Flag = 'done' | 'hot' | 'new' | 'srv';

// [slug, 名称, 说明, 标记(done 已上线 / hot 热门 / new 新增 / srv 需后端), 合并的同类入口数]
type RawTool = [slug: string, name: string, desc: string, flags?: string, merged?: number];
// [id, 名称, 旧版字符图标(已弃用), 色相, 说明, 工具列表]
type RawCat = [id: string, name: string, glyph: string, hue: number, desc: string, tools: RawTool[]];

export interface Category {
  id: string;
  name: string;
  hue: number;
  desc: string;
  icon: string;
  tools: Tool[];
}

export interface Tool {
  id: string;
  slug: string;
  name: string;
  desc: string;
  flags: Flag[];
  merged: number;
  icon: string;
  cat: Category;
}

const RAW: RawCat[] = [
['json','JSON','{}',217,'格式化、校验、对比、转换，处理 JSON 的常用功能',[
 ['format','JSON 格式化校验','格式化、语法校验，用中文说明错误并定位到行列','done hot',2],
 ['minify','JSON 压缩','去掉空白压缩成一行，显示节省的体积','done'],
 ['viewer','JSON 树形视图','折叠展开，点击节点复制路径','done hot'],
 ['escape','JSON 转义 / 去转义','JSON 和字符串互转，调接口时常用','done'],
 ['editor','JSON 编辑器','树形和代码两种模式编辑',''],
 ['diff','JSON 对比','按结构对比，忽略键的顺序，标出增删改','hot'],
 ['merge','JSON 合并','多份 JSON 深度合并',''],
 ['sort','JSON 排序','按键名或值递归排序',''],
 ['clean','JSON 清理','删除 null、空字符串、空数组和空对象',''],
 ['jsonpath','JSONPath 查询','用 $.a[*].b 这样的表达式筛选数据','new'],
 ['schema','JSON Schema','根据示例生成 Schema，或校验数据',''],
 ['to-code','JSON 转代码','Java / C# / Go / TS / Python / Kotlin / Swift / Rust / Dart 等 20 多种语言','hot',22],
 ['yaml','JSON ⇄ YAML','双向转换','done'],
 ['xml','JSON ⇄ XML','双向转换','done',2],
 ['toml','JSON ⇄ TOML','双向转换',''],
 ['csv','JSON ⇄ CSV / Excel','导出成表格，或把 Excel 转成 JSON','done',2],
 ['sql','JSON 转 SQL','生成 CREATE TABLE 和 INSERT 语句',''],
 ['query','JSON ⇄ GET 参数','JSON 和 a=1&b=2 查询字符串互转',''],
 ['php','JSON 转 PHP 数组','生成 PHP array 代码',''],
 ['toon','JSON ⇄ TOON','面向大模型的紧凑格式',''],
 ['postman','JSON ⇄ Postman','Postman 集合和 JSON 互转',''],
 ['mock','测试数据生成','按模板生成 JSON / XML / YAML / CSV / TOML 测试数据','',6]
]],
['encode','编码 / 加密','#',262,'编解码、哈希、对称和非对称加密，都在本地完成',[
 ['base64','Base64 编解码','文本和文件，支持 URL Safe','hot',3],
 ['basex','Base32 / 58 / 62 / 100','多种 Base 编码互转','',2],
 ['url','URL 编解码','encodeURIComponent / decodeURIComponent','hot'],
 ['unicode','Unicode 中文互转','\\u4e2d 和中文互转','done',3],
 ['utf8','UTF-8 编解码','字节序列和文本互转','',2],
 ['html-entity','HTML 实体编解码','&lt; &amp; 等实体互转',''],
 ['escape','Escape 编解码','JS 的 escape / unescape','',3],
 ['hex','十六进制 ⇄ 文本','Hex 字符串和文本互转','',2],
 ['hash','哈希计算','MD5 / SHA-1 / SHA-256 / SHA-3 / Keccak / RIPEMD / CRC 等','hot',10],
 ['file-hash','文件哈希','拖入文件计算 MD5 / SHA 值',''],
 ['hmac','HMAC 签名','HMAC-SHA256 等，调试接口签名','new'],
 ['cipher','对称加密','AES / DES / 3DES / RC4 / Rabbit','hot',4],
 ['rsa','RSA 加解密','生成密钥对、加解密、签名验签',''],
 ['bcrypt','Bcrypt / Scrypt','生成和验证密码哈希','',4],
 ['db-pass','数据库密码','MySQL / PostgreSQL / MariaDB 密码哈希','',3],
 ['htpasswd','htpasswd 生成','Nginx / Apache 的认证文件',''],
 ['jwt','JWT 解析 / 签发','解码 Header 和 Payload，校验签名','hot'],
 ['gzip','Gzip 压缩解压','Gzip + Base64 文本互转',''],
 ['uuid','UUID / GUID 生成','v4 / v7，可批量生成','',2],
 ['password','随机密码生成','自定义长度和字符集','new'],
 ['morse','摩斯密码','文本和摩斯电码互转',''],
 ['js-obf','JS 混淆 / 解密','代码混淆，Eval 加密和解密','',3],
 ['cert','自签名证书','生成自签名 SSL 证书和私钥',''],
 ['thunder','下载链接解码','还原迅雷 / 快车 / 旋风地址',''],
 ['magnet','种子转磁力链','把 torrent 文件转成 magnet 链接',''],
 ['email','邮箱地址加密','防爬虫的邮箱编码','']
]],
['format','格式化','≡',190,'各种代码和配置的美化、压缩',[
 ['js','JS / HTML 格式化','美化和压缩','hot',2],
 ['css','CSS 格式化','美化和压缩',''],
 ['xml','XML 格式化','美化、压缩、排序',''],
 ['sql','SQL 格式化','支持多种数据库方言，美化和压缩','hot'],
 ['code','多语言代码格式化','Java / Python / C / C# / PHP / Ruby / Perl / VBScript','',8],
 ['yaml','YAML 格式化校验','语法检查和美化','',2],
 ['toml','TOML 校验','语法检查和美化',''],
 ['cookie','Cookie 格式化','把 Cookie 字符串转成表格或 JSON',''],
 ['header','HTTP Header 格式化','把请求头文本转成 JSON',''],
 ['url-params','URL 参数解析','把查询参数拆成表格',''],
 ['naming','变量命名转换','驼峰 / 下划线 / 中划线 / 常量风格','hot',2]
]],
['convert','转换','⇄',160,'时间、进制、颜色、单位等日常换算',[
 ['timestamp','时间戳转换','秒 / 毫秒和日期互转，支持多时区','hot',2],
 ['radix','进制转换','2 到 36 进制互转','',2],
 ['color','颜色转换','HEX / RGB / HSL / HSV / CMYK','',2],
 ['unit','单位换算','长度、重量、温度、面积、体积、压力、功率、速度、角度、文件大小','',14],
 ['money','金额大写','人民币，以及美元、日元等 15 种货币','',17],
 ['pinyin','汉字转拼音','带声调或只要首字母',''],
 ['zh-tw','简繁转换','简体、繁体、火星文',''],
 ['width','全角半角转换','全角和半角字符互转','',2],
 ['case','大小写转换','全大写、全小写、首字母大写',''],
 ['num-cn','数字转中文','123 → 一百二十三',''],
 ['qrcode','二维码生成 / 识别','文本、网址、名片，可以加 Logo','hot'],
 ['barcode','条形码生成','Code128 / EAN-13 等',''],
 ['lunar','公历农历转换','包括节气和生肖',''],
 ['latlng','经纬度转换','度分秒，WGS84 / GCJ02 / BD09 坐标互转','',2],
 ['ip-int','IP ⇄ 整数','IPv4 地址和数字互转','',2],
 ['html-md','HTML ⇄ Markdown','双向转换','',2],
 ['html-js','HTML ⇄ JS','HTML 和 document.write 字符串互转','',2],
 ['ubb','HTML ⇄ UBB','论坛 UBB 代码互转',''],
 ['php-ser','PHP 序列化','序列化，或反序列化成 JSON','',3],
 ['csv-html','CSV 转 HTML 表格','生成带样式的表格代码',''],
 ['matrix','矩阵 ⇄ JSON','二维矩阵和 JSON 数组互转','']
]],
['codegen','代码生成','</>',28,'从 curl、SQL 等生成各种语言的代码',[
 ['curl','curl 转代码','Python / Java / Go / Node / PHP / JS 等','hot',14],
 ['sql-entity','SQL 转实体类','MySQL / Oracle 建表语句转 Java / C#','',5],
 ['sql-json','SQL 转 JSON','根据建表语句生成示例 JSON',''],
 ['sql-form','SQL 转表单 / Postman','根据字段生成表单或请求','',2],
 ['props-yaml','properties ⇄ YAML','Spring 配置互转','hot'],
 ['cookie-js','Cookie 转 JS','生成 document.cookie 代码',''],
 ['concat','字符串拼接','把多行文本拼成各种语言的字符串',''],
 ['regex-code','正则代码生成','生成各种语言调用正则的代码',''],
 ['redirect','跳转代码生成','Apache / PHP / Java / JS / ASP / Python 等','',8],
 ['html-server','HTML 转服务端代码','ASP / JSP / VB.NET / Perl','',4],
 ['cron','Cron 表达式生成','可视化生成，预览执行时间','hot'],
 ['robots','robots.txt 生成','勾选规则生成爬虫协议文件',''],
 ['sql-view','SQL 字段对照','插入 / 修改语句的字段对照视图','']
]],
['dev','开发调试','.*',340,'正则、对比、运行代码等调试工具',[
 ['regex','正则表达式测试','实时高亮匹配，内置常用正则','hot'],
 ['diff','文本对比','按行或按字对比，支持合并','hot',3],
 ['xpath','XPath 测试','在 HTML / XML 里测试 XPath','',2],
 ['cron-check','Cron 表达式校验','解释含义，列出接下来的执行时间',''],
 ['run','在线运行代码','Python / Java / Go / C++ 等 40 多种语言','srv',46],
 ['http','HTTP 请求模拟','像 Postman 一样发送任意请求','srv'],
 ['ws','WebSocket 测试','连接、收发消息',''],
 ['ua','UserAgent 解析','识别浏览器、系统、设备','',2],
 ['keycode','键盘按键码','按下按键就显示 keyCode / code','',2],
 ['filetype','文件类型识别','根据文件头（Magic Bytes）识别真实格式',''],
 ['browser','浏览器信息','屏幕、语言、功能支持情况',''],
 ['unzip','压缩包查看','不解压就能查看 zip 里的文件列表','']
]],
['net','网络','@',200,'IP、DNS、证书等网络查询',[
 ['myip','我的 IP','公网 IP 和归属地','srv hot'],
 ['ip','IP 归属地查询','IP 定位和运营商','srv',2],
 ['dns','DNS 解析查询','A / CNAME / MX / TXT / NS 记录','srv',2],
 ['ssl','SSL 证书查询','证书链、有效期、协议套件','srv',2],
 ['headers','网站 Header 查看','响应头和 Cookie','srv',2],
 ['trace','路由追踪','查看到目标网站经过的路由','srv'],
 ['seo','网站 SEO 查询','标题、描述、内链和外链','srv',2],
 ['screenshot','网页截图','输入网址生成整页截图','srv'],
 ['subnet','子网掩码计算','CIDR、可用地址范围','hot',3],
 ['url-parse','URL 解析','拆出协议、域名、路径、参数',''],
 ['ua-gen','随机 UA 生成','生成各种浏览器的 UserAgent','',2],
 ['mac','MAC 地址生成','随机生成 MAC 地址',''],
 ['ip-gen','随机 IP 生成','按地区或网段生成',''],
 ['short','短网址','生成和还原短网址','srv'],
 ['badge','Shield 徽章生成','README 里用的徽章',''],
 ['refresh','网页定时刷新','按设定的间隔自动刷新页面','']
]],
['css','前端 / CSS','✦',290,'CSS 生成器、配色和前端资源',[
 ['gradient','渐变生成器','线性和径向渐变，内置 180 款预设','hot',2],
 ['radius','圆角生成器','可视化调 border-radius','',2],
 ['flex','Flex 布局可视化','调参数实时预览',''],
 ['bezier','贝塞尔曲线','可视化调节 cubic-bezier',''],
 ['animation','动画模板','关键帧和过渡动画','',2],
 ['effects','CSS 特效生成','毛玻璃、新拟态、霓虹灯、故障文字、液态变形、3D 翻转','',6],
 ['palette','配色方案','配色表、中国和日本传统色、WEB 安全色','hot',7],
 ['picker','调色板','取色和颜色格式互转',''],
 ['px','尺寸单位换算','px / em / rem / vw','',2],
 ['sprite','精灵图生成','CSS Sprites',''],
 ['svg','SVG 压缩 / 预览','压缩代码，实时预览','',2],
 ['font','字体查看器','预览 ttf / woff / iconfont',''],
 ['icons','图标库查询','Font Awesome / Bootstrap / Layui','',4],
 ['playground','在线代码编辑器','HTML / CSS / JS 实时预览','',3],
 ['lottie','Lottie 动画预览','拖入 JSON 文件预览动画',''],
 ['popup','弹窗生成器','生成弹窗的 HTML 和 CSS',''],
 ['device','设备 UI 尺寸','iPhone / iPad / Android 设计规范',''],
 ['crx','Chrome 扩展下载','解析 crx 下载地址','']
]],
['image','图片','▣',15,'压缩、转换、编辑，图片不上传',[
 ['compress','图片压缩','JPG / PNG / WebP 批量压缩','hot',2],
 ['convert','图片格式转换','JPG / PNG / WebP / AVIF / TIFF / GIF / BMP 互转','hot',20],
 ['edit','图片编辑','裁剪、缩放、旋转、翻转','',5],
 ['grid','九宫格切图','一张图切成九宫格',''],
 ['watermark','加水印','文字或图片水印',''],
 ['round','图片切圆角','生成圆角或圆形图片',''],
 ['idphoto','证件照换底色','包括常用证件照尺寸标准','',2],
 ['base64','图片 ⇄ Base64','图片和 Data URI 互转','',3],
 ['ico','ICO / App 图标生成','favicon、iOS 和安卓图标','',2],
 ['gif','GIF 制作 / 拆帧','多张图合成 GIF，或拆成帧','',2],
 ['pdf','图片 ⇄ PDF','图片合成 PDF，或 PDF 转图片','',2],
 ['exif','EXIF 查看','拍摄参数和位置',''],
 ['eyedropper','图片取色','点击图片获取颜色值',''],
 ['gray','灰度 / 黑白','生成灰度图或黑白图','',2],
 ['placeholder','占位图生成','指定尺寸和文字',''],
 ['signature','手写签名提取','去掉背景，只留签名',''],
 ['text-img','文字生成图片','设置字体、颜色、背景',''],
 ['svg','图片转 SVG','把位图转成矢量图',''],
 ['ocr','文字识别 OCR','识别图片里的文字','srv'],
 ['draw','涂鸦画板','在线手绘','']
]],
['text','文本','T',45,'去重、排序、统计等批量文本处理',[
 ['dedupe','文本去重','按行去重，可以忽略大小写','hot',2],
 ['lines','空行 / 换行处理','去空行、去换行、合并成一行','',3],
 ['sort','文本排序','按字母、拼音首字母、数字、长度排序','',3],
 ['shuffle','逆序 / 打乱','逆序排列或随机打乱','',3],
 ['number','添加 / 移除序号','给每行加上或去掉序号',''],
 ['column','按列截取','按分隔符取出指定列',''],
 ['count','字数统计','字数、字节数、行数','hot'],
 ['freq','出现次数统计','统计字符或字符串出现的次数','',2],
 ['filter','长度过滤','按长度筛选行',''],
 ['strip','清除中英文 / 数字','只保留需要的字符',''],
 ['sum','数值求和','把一列数字加总',''],
 ['idcard','身份证校验','批量校验，并提取生日','',2],
 ['ascii-art','ASCII 艺术字','把文字转成字符画','',2],
 ['vertical','竖排文字','古风竖排排版','',2],
 ['random','随机字符串','随机汉字、序列号','',2],
 ['markdown','Markdown 编辑器','实时预览','hot'],
 ['quote','SQL 加 / 去引号','批量加上或去掉引号',''],
 ['spacing','文字间隔','在字之间插入分隔符',''],
 ['translate','中英互译','中文和英文互译','srv']
]],
['util','效率工具','∑',120,'日期、图表、计时等常用小工具',[
 ['date','日期计算','间隔天数、加减天数','new'],
 ['chart','图表生成','饼图、柱状图、折线图、散点图、雷达图','',5],
 ['mindmap','思维导图','在线画思维导图',''],
 ['dbdesign','数据库设计','在线画 ER 图',''],
 ['topology','网络拓扑图','在线画拓扑图',''],
 ['stopwatch','秒表 / 倒计时','包括发言倒计时','',2],
 ['lottery','随机点名 / 抽签','导入名单随机抽取',''],
 ['ppi','屏幕 PPI 计算','根据分辨率和尺寸计算',''],
 ['bandwidth','带宽计算','带宽和下载时间换算',''],
 ['disk','硬盘分区计算','计算整数大小的分区',''],
 ['map','地图坐标拾取','高德、搜狗地图拾取坐标','',2],
 ['grid-paper','格子纸生成','方格、田字格，可打印','']
]],
['ref','速查表','☰',230,'开发常用对照表',[
 ['http-status','HTTP 状态码','每个状态码的含义和常见原因','hot'],
 ['http-header','HTTP 请求 / 响应头','每个请求头和响应头的作用','',2],
 ['mime','MIME 类型','文件扩展名和 Content-Type 对照','',2],
 ['ascii','ASCII 码表','包括扩展 ASCII','',2],
 ['entity','HTML 实体 / 转义字符','HTML、XML、JS 的转义字符','',4],
 ['ports','常用端口','端口号和对应的服务',''],
 ['regex','正则速查','语法和常用正则',''],
 ['operator','运算符优先级','Java / C / PHP / Python',''],
 ['emoji','Emoji / 特殊符号','点击就能复制','',4],
 ['keyboard','键盘符号名称','中英文名称对照',''],
 ['magic','Magic Bytes 对照表','各种文件的文件头',''],
 ['morse','摩斯电码表','字母、数字、标点',''],
 ['dns','公共 DNS','IPv4 / IPv6','',2],
 ['mirrors','国内镜像源','npm / pip / maven / composer / gem','',5],
 ['android-perm','Android 权限','权限名称和说明',''],
 ['gb2312','GB2312 编码表','汉字编码对照','']
]]
];

export const CATEGORIES: Category[] = RAW.map(([id, name, , hue, desc, list]) => {
  const cat: Category = { id, name, hue, desc, icon: CAT_ICON[id] ?? 'wrench', tools: [] };
  cat.tools = list.map(([slug, tname, tdesc, flags = '', merged = 1]) => ({
    id: `${id}/${slug}`,
    slug,
    name: tname,
    desc: tdesc,
    flags: flags.split(/\s+/).filter(Boolean) as Flag[],
    merged,
    icon: TOOL_ICON[`${id}/${slug}`] ?? cat.icon,
    cat,
  }));
  return cat;
});

export const TOOLS: Tool[] = CATEGORIES.flatMap((c) => c.tools);
export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));
export const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const hasFlag = (t: Tool, f: Flag): boolean => t.flags.includes(f);
export const isLive = (t: Tool): boolean => hasFlag(t, 'done');
export const toolPath = (t: Tool): string => `/${t.id}/`;

/** 开发计划：每个分类在第几步实现（开发期间在工具页提示用） */
export const STEP: Record<string, number> = {
  json: 2, encode: 3, format: 4, convert: 4, codegen: 4,
  dev: 5, net: 5, css: 5, image: 5, text: 5, util: 5, ref: 5,
};

export const SITE = {
  name: '快JSON',
  url: 'https://www.kuaijson.com',
  title: '快JSON - 开发者在线工具箱 | JSON 格式化、编解码、转换',
  desc: '免费在线开发者工具箱：JSON 格式化校验、树形查看、压缩转义，JSON 转 YAML / XML / CSV，Unicode 编解码等。数据只在浏览器本地处理，不上传服务器。',
};

# 一次性补丁：统一 practice/ 下作品页（运行后由工作流自动删除）
import re, hashlib, sys
D = 'practice/'
HASH_IN = {'abyssal-garden': 'f852bd8077ddd46fc00eb8cd2f7d2b2ee2aa51302dce2d1d70f311ea7610010b', 'voxel-haizhu': 'e994f9f7d6866cbf235971729aca40f1f315bce6999d140e176e6af32cfb029f', 'voxel-shenzhen': '5c36c878d128952a8ff106ee3ef3233af99b9d8d6a0b8f8d619a09029da28195', 'pelican': 'b180c4b0c65071126ccade4e95f045ad47f8f3c02e560c7a71990221cd948c0c', 'the-tea-ride': 'c6bf6bd54a817396e2bc093f321c95d64049b4bbccb859bc9db33b16a5734b65', 'pirate-ship-sunset': 'c5dd25857fdad88fb0facc23a44f4155ce34ff2f011dd66ac47c5c659e064b82', 'wobble-rush-3d': '31595da5c2a89d9dfda77d8bea48f39e2460ef242b20450be50c61c2b9e9f163', 'second-light': '8f01c99b11e15b04a4429827eb8b2ac7a5f164bb66e590dd22b082d288954019'}
HASH_OUT = {'abyssal-garden': 'ba47114ef664944899e5f9f1d1e5653d9a322f21028b02d8c1e6988def398d10', 'voxel-haizhu': '6b365826e7ed0d10201b32ac67b573aefcff1cf0ca953695127379be531d2392', 'voxel-shenzhen': 'a1f079e942a5aac3bc8b5ecdf323afad8359f4aa6523fd51d731822c65979676', 'pelican': '208504a45ef76a07fa28f582dcfbb53ea35a08468567a7cc597574b26e14f4e9', 'the-tea-ride': '2a0e1ea34253a9e6e5226268d2c0fb4a7b62d04da4ba73aa17b76caafa1b12a4', 'pirate-ship-sunset': '5b632001a229d78ad09a3413da86bff6c0538d3c1235fdaa00f09176ddbcab6c', 'wobble-rush-3d': 'cdb99d64df5ddfcf2fcc5baffab9414124981d64bd977cc528d56718b987bf1f', 'second-light': '2598c6fe1e8be660e2fef5602ae9298ca655e791f99698642bd5756ebe149f76'}

def rd(f):
    b = open(D + f + '.html', 'rb').read()
    assert hashlib.sha256(b).hexdigest() == HASH_IN[f], f + ' 与预期原文不一致，已中止'
    return b.decode('utf-8')

def once(s, a, b, tag):
    n = s.count(a)
    assert n == 1, '[%s] 期望 1 处，实际 %d 处' % (tag, n)
    return s.replace(a, b)

OLD_TOP = '.hd-back{position:fixed;top:calc(env(safe-area-inset-top) + 12px);right:12px;z-index:2147483647;\n'
NEW_TOP = OLD_TOP[:-1] + 'box-sizing:border-box;\n'

ref = rd('voxel-haizhu')
i = ref.find('<a class="hd-back"'); j = ref.find('</style>', i) + 8
BACK = ref[i:j].replace(OLD_TOP, NEW_TOP)
LINK, STYLE = BACK[:BACK.find('<style')].rstrip('\n'), BACK[BACK.find('<style'):]

def add_back(s, extra=''):
    assert 'hd-back' not in s
    blk = BACK if not extra else BACK.replace('\n</style>', '\n' + extra + '\n</style>')
    k = s.rfind('</body>')
    return s[:k] + blk + '\n' + s[k:]

res = {}
for f in ['abyssal-garden', 'voxel-haizhu']:
    res[f] = once(rd(f), OLD_TOP, NEW_TOP, f)

s = rd('voxel-shenzhen')
s = once(s, '<!DOCTYPE html>\n<!-- design-style: humanist-literary -->\n', '<!DOCTYPE html>\n', 'c1')
s = once(s, '<title>双城体素小世界</title>', '<title>深圳摩天轮</title>', 'title')
s = once(s, '<meta name="omega:scene" content="webpage">\n<meta name="omega:version" content="1">\n',
         '<meta name="description" content="深圳与东京两座体素小城，海风把摩天轮吹得很慢，各处藏着彩蛋。">\n', 'meta')
s = re.sub(r'<meta name="omega:source-files"[^>]*>\n', '', s, count=1)
s = re.sub(r'<div data-omega-watermark[^>]*>[^<]*</div>', '', s, count=1)
s = once(s, ' * 双城体素小世界\n', ' * 深圳摩天轮\n', 'h')
s = once(s, '在上一个文件里；这里是', '在前面的「场景一」里；这里是', 'n1')
s = once(s, '街面沿用上一个文件的 tokyoCore；', '街面沿用前面「场景二」的 tokyoCore；', 'n2')
s = once(s, ' * 本文件新增：', ' * 在此基础上新增：', 'n3')
s = re.sub(r'<style data-omega-edit-layer>[\s\S]*?</style>\n?', '', s)
s = re.sub(r'<script data-omega-edit-layer>[\s\S]*?</script>\n?', '', s)
s = re.sub(r'<!-- /?section:\w+ -->\n', '', s)
s = re.sub(r' data-dt-card="\w+"', '', s)
s = once(s, OLD_TOP, NEW_TOP, 'sz-back')
res['voxel-shenzhen'] = s

for f in ['pelican', 'pirate-ship-sunset', 'the-tea-ride']:
    res[f] = add_back(rd(f))
res['wobble-rush-3d'] = add_back(rd('wobble-rush-3d'), '#hud{padding-top:calc(var(--edge) + 44px)}')

s = rd('second-light')
s = once(s, '</head>', STYLE.replace('\n</style>', '\n@media(max-width:960px){header{padding-right:76px}}\n</style>') + '\n</head>', 'sl-head')
js = LINK.replace('\\', '\\\\').replace("'", "\\'")
s = once(s, "    draw(true);\n    window.requestAnimationFrame(tick);\n  }\n",
         "    draw(true);\n    window.requestAnimationFrame(tick);\n    // 播放器重写了 body，在这里补上「返回合集」按钮\n"
         "    document.body.insertAdjacentHTML('beforeend', '" + js + "');\n  }\n", 'sl-js')
res['second-light'] = s


def title_to_head(s, tag):
    m = re.search(r'\n?<title>[^<]*</title>', s)
    he = s.find('</head>')
    assert m and he > 0 and m.start() > he, tag + ' title 位置异常'
    t = m.group(0).strip()
    s = s[:m.start()] + s[m.end():]
    he = s.find('</head>')
    return s[:he] + t + s[he:]
res['pelican'] = title_to_head(res['pelican'], 'pelican')
res['pirate-ship-sunset'] = once(title_to_head(res['pirate-ship-sunset'], 'pirate'), '<!doctype html><html><head>', '<!doctype html><html lang="en"><head>', 'pirate-lang')

for f, s in res.items():
    b = s.encode('utf-8')
    assert hashlib.sha256(b).hexdigest() == HASH_OUT[f], f + ' 输出与预期不一致，已中止'
for f, s in res.items():
    open(D + f + '.html', 'wb').write(s.encode('utf-8'))
    print('ok', f)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合并三份资料到一个JSON文件
"""
import json
import time

# 读取AI开发作为基础
print("读取 AI开发.json...")
with open('/mnt/c/Users/qq139/Downloads/AI开发.json', 'r', encoding='utf-8') as f:
    base_data = json.load(f)

# 读取计算机视觉
print("读取 计算机视觉.json...")
with open('/mnt/c/Users/qq139/Downloads/计算机视觉.json', 'r', encoding='utf-8') as f:
    cv_data = json.load(f)

# 读取软件开发
print("读取 软件开发.json...")
with open('/mnt/c/Users/qq139/Downloads/软件开发.json', 'r', encoding='utf-8') as f:
    sw_data = json.load(f)

# 创建合并后的数据结构
merged_data = {
    'version': '2.0.0',
    'createdAt': base_data.get('createdAt', ''),
    'profiles': [],
    'activeProfileId': '',
    'settings': base_data.get('settings', {}),
    'submissions': base_data.get('submissions', []),
    'logs': base_data.get('logs', [])
}

# 添加三个资料
profiles = []

# 1. AI开发资料（使用原始数据的第一个profile）
ai_profile = base_data['profiles'][0].copy()
ai_profile['name'] = 'AI开发'
ai_profile['id'] = 'id_' + str(int(time.time() * 1000)) + '_ai_dev'
profiles.append(ai_profile)
print(f"✓ 添加资料: {ai_profile['name']} (ID: {ai_profile['id']})")

# 2. 计算机视觉资料
cv_profile = cv_data['profiles'][0].copy()
cv_profile['name'] = '计算机视觉'
cv_profile['id'] = 'id_' + str(int(time.time() * 1000) + 1) + '_cv'
profiles.append(cv_profile)
print(f"✓ 添加资料: {cv_profile['name']} (ID: {cv_profile['id']})")

# 3. 软件开发资料
sw_profile = sw_data['profiles'][0].copy()
sw_profile['name'] = '软件开发'
sw_profile['id'] = 'id_' + str(int(time.time() * 1000) + 2) + '_sw_dev'
profiles.append(sw_profile)
print(f"✓ 添加资料: {sw_profile['name']} (ID: {sw_profile['id']})")

# 设置profiles和activeProfileId
merged_data['profiles'] = profiles
merged_data['activeProfileId'] = profiles[0]['id']  # 默认激活第一个（AI开发）

print(f"\n合并后的数据:")
print(f"  - 资料总数: {len(merged_data['profiles'])}")
print(f"  - 激活资料ID: {merged_data['activeProfileId']}")
print(f"  - 资料列表:")
for p in merged_data['profiles']:
    print(f"    * {p['name']} (ID: {p['id']}, 项目数: {len(p.get('projects', []))})")

# 保存合并后的文件
output_path = '/mnt/c/Users/qq139/Downloads/全部资料合集.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(merged_data, f, ensure_ascii=False, indent=2)

print(f"\n✅ 已保存到: {output_path}")
print(f"\n现在可以导入这个文件，就能看到3个资料可以切换了！")

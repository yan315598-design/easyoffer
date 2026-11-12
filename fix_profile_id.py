#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复JSON文件的activeProfileId指向问题
"""
import json

files = {
    '计算机视觉': '/mnt/c/Users/qq139/Downloads/计算机视觉.json',
    '软件开发': '/mnt/c/Users/qq139/Downloads/软件开发.json'
}

for name, fpath in files.items():
    print(f'\n修复 {name}.json...')

    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if data.get('profiles') and len(data['profiles']) > 0:
        # 获取第一个资料（也就是我们填充了完整信息的资料）的ID
        first_profile_id = data['profiles'][0]['id']
        first_profile_name = data['profiles'][0].get('name', '')

        print(f'  第一个资料ID: {first_profile_id}')
        print(f'  第一个资料名称: {first_profile_name}')
        print(f'  当前activeProfileId: {data.get("activeProfileId")}')

        # 修改activeProfileId指向第一个资料
        data['activeProfileId'] = first_profile_id

        # 删除其他空资料（profiles[1]和profiles[2]）
        data['profiles'] = [data['profiles'][0]]

        print(f'  修改后activeProfileId: {data["activeProfileId"]}')
        print(f'  保留资料数量: {len(data["profiles"])}')

        # 保存
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f'✓ 已修复并保存')
    else:
        print(f'✗ 文件格式错误')

print('\n✅ 修复完成！现在可以重新导入了。')

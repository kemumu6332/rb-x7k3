#!/usr/bin/env python3
# GMOクリック証券FXネオの公式スワップ実績(TRY/JPY)を取得し、
# GAS上の rb-data.json の swapCal に日別単価を蓄積する日次ルーチン。
# 変更があれば GAS へ update POST → リポジトリの data.json も同期して git push する。
# 使い方: python3 fetch_swap_daily.py   (出力の最終行が SUMMARY: で始まる)
import datetime
import json
import re
import subprocess
import sys
import time
import urllib.request

GAS = 'https://script.google.com/macros/s/AKfycbxoZOcYdGK5VYYDuOYfqRGpACps87MnaXzmix2V5KG0JE0cnOqXr3kGSWa7-JmUmoovOQ/exec'
KEY = 'rb-x7k3-up'
REPO = '/Users/issei/FX/rb-tool'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}

# 行の形: <td>7月23日(木)</td><td>-25</td><td>25</td><td>1</td>
# 未来日は売/買が空セルなので optional group にして skip する
ROW = re.compile(
    r'<td[^>]*>\s*(\d{1,2})月(\d{1,2})日[^<]*</td>\s*'
    r'<td[^>]*>\s*(-?\d+)?\s*</td>\s*'
    r'<td[^>]*>\s*(-?\d+)?\s*</td>\s*'
    r'<td[^>]*>\s*(\d+)?\s*</td>')


def fetch_month(year, month):
    url = (f'https://www.click-sec.com/corp/guide/fxneo/swplog/'
           f'?year={year}&month={month:02d}&pare=TRYJPY')
    html = urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=30).read().decode('utf-8')
    out = {}
    for mo, day, sell, buy, days in ROW.findall(html):
        if int(mo) != month or buy is None or buy == '':
            continue
        iso = f'{year}-{int(mo):02d}-{int(day):02d}'
        out[iso] = {'b': int(buy), 'd': int(days or 0)}
    return out


def main():
    today = datetime.date.today()
    months = [(today.year, today.month)]
    if today.day <= 3:  # 月初は前月分の取りこぼしも拾う
        prev = today.replace(day=1) - datetime.timedelta(days=1)
        months.insert(0, (prev.year, prev.month))
    cal = {}
    for y, m in months:
        cal.update(fetch_month(y, m))
    if not cal:
        print('SUMMARY: error 公式ページから1行も取得できず（ページ構造変更の可能性）')
        sys.exit(1)

    data = json.load(urllib.request.urlopen(GAS + '?key=' + KEY, timeout=60))
    if not data.get('profiles'):
        print('SUMMARY: error GAS doGetがprofilesを返さない')
        sys.exit(1)
    sc = data.get('swapCal') or {}
    changed = {k: v for k, v in cal.items() if sc.get(k) != v}
    if not changed:
        print('SUMMARY: ok 新規データなし（既に最新）')
        return
    sc.update(cal)
    data['swapCal'] = dict(sorted(sc.items()))
    data['_ts'] = int(time.time() * 1000)

    payload = json.dumps({'key': KEY, 'action': 'update', 'data': data},
                         ensure_ascii=False).encode()
    res = json.load(urllib.request.urlopen(
        urllib.request.Request(GAS, data=payload,
                               headers={'Content-Type': 'text/plain'}),
        timeout=60))
    if not res.get('ok'):
        print(f'SUMMARY: error GAS update失敗 {res}')
        sys.exit(1)

    repo_data = {'_ts': data['_ts'], '_note': data.get('_note', ''),
                 'profiles': data['profiles'], 'swapCal': data['swapCal']}
    with open(REPO + '/data.json', 'w') as f:
        json.dump(repo_data, f, ensure_ascii=False, indent=1)
    subprocess.run(['git', '-C', REPO, 'add', 'data.json'], check=True)
    if subprocess.run(['git', '-C', REPO, 'diff', '--cached', '--quiet']).returncode != 0:
        subprocess.run(['git', '-C', REPO, 'commit', '-q', '-m',
                        f'swapCal自動更新 {today.isoformat()}: {", ".join(sorted(changed))}'],
                       check=True)
        subprocess.run(['git', '-C', REPO, 'push', '-q'], check=True)

    latest = [f'{k}={v["b"]}円/{v["d"]}日' for k, v in sorted(changed.items())]
    print(f'SUMMARY: ok 追加{len(changed)}件: ' + ', '.join(latest[-5:]))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Run an actual Sepolia demo against the address recorded in deployments/sepolia.json.

Creates new demo campaigns on each run. Logs each command before continuing.
Never automatically retries a write with an unknown outcome.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
DEPLOYMENT = json.loads((ROOT / 'deployments/sepolia.json').read_text())
ADDRESS = DEPLOYMENT['contract_address']
if DEPLOYMENT['network'] != 'sepolia' or not ADDRESS:
    raise SystemExit('A recorded Sepolia deployment is required')
resume = len(sys.argv) == 3 and sys.argv[1] == '--resume-before-burn'
if len(sys.argv) > 1 and not resume:
    raise SystemExit('Usage: sepolia-smoke.py [--resume-before-burn smoke-RUN]')
if resume:
    OUT = ROOT / 'deployments' / sys.argv[2]
    if OUT.resolve().parent != (ROOT / 'deployments').resolve():
        raise SystemExit('Resume directory must be under deployments/')
    RUN = OUT.name.removeprefix('smoke-')
    SUMMARY = json.loads((OUT / 'summary.json').read_text())
    if SUMMARY['contract_address'] != ADDRESS or len(SUMMARY['transactions']) != 4:
        raise SystemExit('Resume is only supported immediately before the first burn')
    if SUMMARY['transactions'][-1]['step'] != 'maria-activate':
        raise SystemExit('Unexpected resume state')
    sequence = max(int(p.name.split('-')[0]) for p in OUT.glob('*.jsonl'))
    SUMMARY['status'] = 'running'
    SUMMARY.pop('error', None)
else:
    RUN = str(int(time.time()))
    OUT = ROOT / 'deployments' / ('smoke-' + RUN)
    OUT.mkdir()
    SUMMARY = {'network': 'sepolia', 'contract_address': ADDRESS, 'status': 'running',
               'transactions': [], 'negative_checks': [], 'readings': {}}
    sequence = 0
selectors = {}


def save():
    (OUT / 'summary.json').write_text(json.dumps(SUMMARY, indent=2) + '\n')


def command(args, label, expected_error=None):
    global sequence
    sequence += 1
    path = OUT / f'{sequence:02d}-{label}.jsonl'
    print(label, flush=True)
    with path.open('w') as log:
        process = subprocess.run([str(ROOT / 'scripts/sepolia'), *map(str, args)],
                                 cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    output = path.read_text()
    if expected_error:
        if expected_error not in output or '"transaction_hash"' in output:
            raise RuntimeError(f'Expected {expected_error}, inspect {path}')
        SUMMARY['negative_checks'].append({'check': label, 'error': expected_error,
                                           'simulation_only': True, 'log': path.name})
        save()
        return None
    records = []
    for line in output.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if 'command' in record:
            records.append(record)
    if process.returncode or not records or records[-1].get('error') or records[-1].get('type') == 'error':
        raise RuntimeError(f'Command failed or outcome unknown; inspect {path} before retrying')
    return records[-1]


def transaction(args, label):
    result = command(args, label)
    tx = result['transaction_hash']
    SUMMARY['transactions'].append({'step': label, 'transaction_hash': tx})
    save()
    receipt = command(['get', 'tx-receipt', tx], label + '-receipt')
    if receipt.get('execution_status') != 'SUCCEEDED' or receipt.get('finality_status') not in ('ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'):
        raise RuntimeError(f'Transaction not confirmed successfully: {tx}')
    SUMMARY['transactions'][-1].update({
        'execution_status': receipt['execution_status'],
        'finality_status': receipt['finality_status'],
        'actual_fee_fri': str(int(receipt['actual_fee']['amount'], 16)),
    })
    save()
    return receipt


def invoke_args(function, calldata):
    return ['invoke', '--contract-address', ADDRESS, '--function', function,
            '--calldata', *map(str, calldata)]


def invoke(function, calldata, label):
    return transaction(invoke_args(function, calldata), label)


def read(function, calldata, label):
    args = ['call', '--contract-address', ADDRESS, '--function', function]
    if calldata:
        args += ['--calldata', *map(str, calldata)]
    result = command(args, label)
    values = [int(x, 16) for x in result['response_raw']]
    SUMMARY['readings'][label] = values
    save()
    return values


def events(receipt, name):
    if name not in selectors:
        text = subprocess.check_output([str(ROOT / 'scripts/tool'), 'sncast', '--json',
                                        'utils', 'selector', name], cwd=ROOT, text=True)
        selectors[name] = int(json.loads(text)['selector'], 16)
    return [e for e in receipt['events'] if int(e['from_address'], 16) == int(ADDRESS, 16)
            and int(e['keys'][0], 16) == selectors[name]]


def tag(text):
    return int.from_bytes(hashlib.sha256(('tipper-testnet-demo:' + RUN + ':' + text).encode()).digest(), 'big') & ((1 << 250) - 1)


def create_campaign(kind, cap, label):
    receipt = invoke('create_campaign', [kind, cap, int(time.time()) + 30 * 86400, tag(label)], label)
    return int(events(receipt, 'CampaignCreated')[0]['keys'][1], 16)


def create_series(campaign, source, code, cap, label):
    receipt = invoke('create_series', [campaign, tag(source), int.from_bytes(code.encode(), 'big'), cap], label)
    return int(events(receipt, 'SeriesCreated')[0]['keys'][2], 16)


def issue(campaign, series, count, label):
    receipt = invoke('issue_coupons', [campaign, series, count, *[tag(f'{label}-{i}') for i in range(count)]], label)
    ids = [int(e['data'][0], 16) for e in events(receipt, 'CouponIssued')]
    assert len(ids) == count and len(set(ids)) == count
    return ids


def reject(function, calldata, error, label):
    command([*invoke_args(function, calldata), '--dry-run'], label, expected_error=error)


save()
try:
    if resume:
        creator = SUMMARY['creator']['campaign_id']
        maria = SUMMARY['creator']['series_id']
        coupons = SUMMARY['creator']['coupon_ids']
        existing = read('get_campaign', [creator], 'resume-verify-unconsumed-campaign')
        assert existing[0] == int(DEPLOYMENT['account_address'], 16)
        assert existing[1:4] == [0, 1, 100] and existing[5:7] == [50, 0]
    else:
        creator = create_campaign(0, 100, 'creator-campaign')
        maria = create_series(creator, 'maria', 'MARIA10', 100, 'maria-series')
        coupons = issue(creator, maria, 50, 'maria-issue-50')
        SUMMARY['creator'] = {'campaign_id': creator, 'series_id': maria, 'coupon_ids': coupons}
        save()
        invoke('activate_campaign', [creator], 'maria-activate')
    calls = ['multicall', 'execute']
    for i, coupon in enumerate(coupons[:20]):
        if i:
            calls.append('/')
        calls += invoke_args('redeem_coupon', [coupon, tag(f'maria-conversion-{i}')])
    command(['multicall', 'execute', '--dry-run', '--detailed', *calls[2:]], 'maria-burn-20-estimate')
    transaction(calls, 'maria-burn-20')
    campaign = read('get_campaign', [creator], 'creator-state')
    series = read('get_series', [creator, maria], 'maria-state')
    assert campaign[2] == 1 and campaign[3] == 100 and campaign[5:7] == [50, 20]
    assert series[2:] == [100, 50, 20]
    assert read('is_redeemable', [coupons[0]], 'consumed-not-redeemable') == [0]
    assert read('is_redeemable', [coupons[20]], 'remaining-redeemable') == [1]
    reject('redeem_coupon', [coupons[0], tag('retry')], 'ALREADY_REDEEMED', 'reject-double-burn')
    reject('issue_coupons', [creator, maria, 1, tag('late-mint')], 'INVENTORY_FROZEN', 'reject-late-mint')
    assert read('get_campaign', [creator], 'creator-state-after-rejections') == campaign
    SUMMARY['creator'].update({'issued': 50, 'redeemed': 20, 'unconsumed': 30})
    save()

    referral = create_campaign(1, 2, 'referral-campaign')
    first = create_series(referral, 'referrer-a', 'REF_A', 1, 'referral-series-a')
    second = create_series(referral, 'referrer-b', 'REF_B', 1, 'referral-series-b')
    first_id = issue(referral, first, 1, 'referral-issue-a')[0]
    second_id = issue(referral, second, 1, 'referral-issue-b')[0]
    SUMMARY['referral'] = {'campaign_id': referral, 'series_ids': [first, second],
                           'coupon_ids': [first_id, second_id]}
    save()
    invoke('activate_campaign', [referral], 'referral-activate')
    conversion = tag('same-referral-conversion')
    invoke('redeem_coupon', [first_id, conversion], 'referral-burn')
    reject('redeem_coupon', [second_id, conversion], 'DUPLICATE_CONVERSION', 'reject-double-attribution')
    assert read('get_campaign', [referral], 'referral-state')[5:7] == [2, 1]
    assert read('get_series', [referral, first], 'referral-a-state')[3:] == [1, 1]
    assert read('get_series', [referral, second], 'referral-b-state')[3:] == [1, 0]
    assert read('is_redeemable', [second_id], 'referral-b-still-redeemable') == [1]
    assert read('conversion_coupon', [referral, conversion], 'referral-conversion-owner') == [first_id]
    SUMMARY['referral'].update({'issued': 2, 'redeemed': 1, 'unconsumed': 1})
    SUMMARY['status'] = 'passed'
    save()
    print('Sepolia smoke test PASSED:', OUT / 'summary.json', flush=True)
except Exception as error:
    SUMMARY['status'] = 'incomplete'
    SUMMARY['error'] = str(error)
    save()
    raise

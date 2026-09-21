"""Configure only conversation preferences; never print or change Wi-Fi credentials.

Run with bleak installed, after entering the robot's startup Settings screen.
The exact device address must be supplied; discovery alone does not authorize writes.
"""
import argparse
import asyncio
import json
from pathlib import Path

from bleak import BleakClient, BleakScanner

RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--address')
    parser.add_argument('--endpoint')
    args = parser.parse_args()
    if not args.address:
        devices = await BleakScanner.discover(timeout=10)
        print(json.dumps([{'name': d.name, 'address': d.address} for d in devices if d.name == 'STK']))
        return
    if not args.endpoint or not args.endpoint.startswith('ws://'):
        raise ValueError('An explicit trusted-LAN ws:// endpoint is required')
    token = (Path(__file__).resolve().parents[1] / 'dist/runtime/device-token').read_text().strip()
    settings = {
        'conversation.backend': 'gateway', 'conversation.autoStart': '0',
        'gateway.endpoint': args.endpoint, 'gateway.deviceId': 'stackchan-01',
        'gateway.clientId': 'cores3', 'gateway.token': token, 'gateway.microphone': '1',
    }
    seen = {}
    def receive(_characteristic, data):
        try:
            obj = json.loads(data.decode())
            if obj.get('prop') in settings:
                seen[obj['prop']] = obj.get('value')
        except (UnicodeDecodeError, ValueError):
            pass
    async with BleakClient(args.address, timeout=20) as client:
        await client.start_notify(TX, receive)
        await asyncio.sleep(2)
        for key, value in settings.items():
            payload = json.dumps({'prop': key, 'value': value}).encode()
            for offset in range(0, len(payload), 128):
                await client.write_gatt_char(RX, payload[offset:offset + 128], response=True)
            await asyncio.sleep(0.3)
        await asyncio.sleep(2)
        missing = [key for key, value in settings.items() if str(seen.get(key)) != value]
        print(json.dumps({'verified': not missing, 'unconfirmed_keys': missing}))
        if missing:
            raise RuntimeError('Some preference acknowledgements were not received; reconnect to verify')


asyncio.run(main())

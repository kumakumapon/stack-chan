#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

/*
 * Crosses a JSON string each way between the browser's Host.Performance
 * bridge (web/simulator/bridge.mjs createHostPerformanceBridge) and XS. None
 * of the other WASM bridges cross a string, only integers (button/touch/IMU)
 * or raw bytes copied through HEAPU8 (camera/audio), so this follows the
 * latter's two-step "measure, then copy" shape rather than an Emscripten
 * string helper: the build's EXPORTED_RUNTIME_METHODS only guarantees
 * HEAP8/HEAPU8 (see scripts/build-wasm.sh), so string encode/decode is done
 * with the standard TextEncoder/TextDecoder Web APIs already relied on
 * elsewhere in bridge.mjs, and only HEAPU8 crosses the EM_ASM boundary.
 */

void xs_stackchan_wasm_performance_take(xsMachine* the)
{
	int length = EM_ASM_INT({
		const performance = stackchanRuntime.host && stackchanRuntime.host.Performance;
		const json = performance && performance.take ? performance.take() : "";
		const text = typeof json === "string" ? json : "";
		const bytes = new TextEncoder().encode(text);
		stackchanRuntime.state.performanceTake = bytes;
		return bytes.byteLength;
	});
	if (length <= 0) {
		xsmcSetString(xsResult, "");
		return;
	}

	char* buffer = malloc(length + 1);
	if (!buffer)
		xsUnknownError("no memory");
	EM_ASM({
		const bytes = stackchanRuntime.state.performanceTake;
		if (bytes) HEAPU8.set(bytes, $0);
	}, buffer);
	buffer[length] = '\0';
	xsmcSetString(xsResult, buffer);
	free(buffer);
}

void xs_stackchan_wasm_performance_status(xsMachine* the)
{
	char* json = xsmcToString(xsArg(0));
	int length = (int)strlen(json);
	EM_ASM({
		const bytes = HEAPU8.subarray($0, $0 + $1);
		const text = new TextDecoder().decode(bytes);
		const performance = stackchanRuntime.host && stackchanRuntime.host.Performance;
		if (performance && performance.setStatus)
			performance.setStatus(text);
	}, json, length);
}

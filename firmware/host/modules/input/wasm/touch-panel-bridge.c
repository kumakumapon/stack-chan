#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_wasm_touch_panel_available(xsMachine* the)
{
	int available = EM_ASM_INT({
		const touchPanel = stackchanRuntime.host && stackchanRuntime.host.TouchPanel;
		return (touchPanel && touchPanel.read) ? 1 : 0;
	});
	xsmcSetInteger(xsResult, available);
}

void xs_stackchan_wasm_touch_panel_read(xsMachine* the)
{
	int channel = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : -1;
	int value = EM_ASM_INT({
		const touchPanel = stackchanRuntime.host && stackchanRuntime.host.TouchPanel;
		if (!touchPanel || !touchPanel.read)
			return 0;
		const value = touchPanel.read($0);
		return Number.isFinite(value) ? Math.round(value) : 0;
	}, channel);
	xsmcSetInteger(xsResult, value);
}

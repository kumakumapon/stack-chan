#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_wasm_imu_available(xsMachine* the)
{
	int available = EM_ASM_INT({
		const imu = stackchanRuntime.host && stackchanRuntime.host.IMU;
		return (imu && imu.read) ? 1 : 0;
	});
	xsmcSetInteger(xsResult, available);
}

void xs_stackchan_wasm_imu_read(xsMachine* the)
{
	int axis = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : -1;
	double value = EM_ASM_DOUBLE({
		const imu = stackchanRuntime.host && stackchanRuntime.host.IMU;
		if (!imu || !imu.read)
			return 0;
		const value = imu.read($0);
		return Number.isFinite(value) ? value : 0;
	}, axis);
	xsmcSetNumber(xsResult, value);
}

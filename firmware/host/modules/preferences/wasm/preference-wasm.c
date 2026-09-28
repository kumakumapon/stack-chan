#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>

// The simulator keeps Pet growth in browser storage, independently of its
// IndexedDB MOD archive. Other simulated preferences retain their prior
// in-memory behavior.
void xs_stackchan_wasm_pet_preference_get(xsMachine* the)
{
	char* value = (char*)EM_ASM_PTR({
		try {
			const saved = globalThis.localStorage?.getItem('stackchan.pet.state.v1');
			if (saved == null)
				return 0;
			const length = lengthBytesUTF8(saved) + 1;
			const pointer = _malloc(length);
			if (!pointer)
				return 0;
			stringToUTF8(saved, pointer, length);
			return pointer;
		} catch {
			return 0;
		}
	});
	if (!value) {
		xsmcSetNull(xsResult);
		return;
	}
	xsmcSetString(xsResult, value);
	free(value);
}

void xs_stackchan_wasm_pet_preference_set(xsMachine* the)
{
	const char* value = xsmcToString(xsArg(0));
	EM_ASM({
		try {
			globalThis.localStorage?.setItem('stackchan.pet.state.v1', UTF8ToString($0));
		} catch {
			// The XS in-memory value remains usable if browser storage is disabled.
		}
	}, value);
}

void xs_stackchan_wasm_pet_preference_delete(xsMachine* the)
{
	EM_ASM({
		try {
			globalThis.localStorage?.removeItem('stackchan.pet.state.v1');
		} catch {
		}
	});
}

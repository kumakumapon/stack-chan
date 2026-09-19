#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
void xs_gateway_exchange(xsMachine* the) {
  char* json = xsmcToString(xsArg(0));
  int size = strlen(json);
  int length = EM_ASM_INT({
    let result;
    try {
      const request = JSON.parse(new TextDecoder().decode(HEAPU8.subarray($0, $0 + $1)));
      const bridge = stackchanRuntime.host && stackchanRuntime.host.Conversation;
      result = bridge ? bridge.exchange(request) : null;
    } catch (error) { result = { error: String(error) }; }
    const bytes = new TextEncoder().encode(JSON.stringify(result === undefined ? null : result));
    stackchanRuntime.state.gatewayResult = bytes;
    return bytes.length;
  }, json, size);
  char* buffer = malloc(length + 1);
  if (!buffer) xsUnknownError("no memory");
  EM_ASM({ HEAPU8.set(stackchanRuntime.state.gatewayResult, $0); }, buffer);
  buffer[length] = 0;
  xsmcSetString(xsResult, buffer);
  free(buffer);
}

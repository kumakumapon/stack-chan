/*
 * Line-oriented driver for the vendored C converter, used only by the Node
 * regression test (text-conversion-regression.test.ts). It links the same
 * source and dictionary as the manual reproduction tool in this directory
 * (text-conversion-probe.c) but takes its cases from stdin instead of a
 * fixed list, so the test can drive it with `prepareStackchanVoiceText`'s
 * actual output. See that file's sibling README for the manual reproduction
 * workflow this regression test automates.
 *
 * For each stdin line, prints `err=<code>\treading=<text>` (or `(failed)`
 * for the reading on error) on its own line, in input order. Never touches
 * hardware or a fake synthesizer.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "aqk2r.h"

static unsigned char *dictionary;
static size_t dictionary_size;
size_t aqdic_open(void) { return dictionary ? 4 : 0; }
size_t aqdic_read(size_t pos, size_t size, void *out) {
    if (pos < 4 || pos - 4 > dictionary_size || size > dictionary_size - (pos - 4)) return 0;
    memcpy(out, dictionary + pos - 4, size);
    return size;
}
void aqdic_close(void) {}

int main(int argc, char **argv) {
    unsigned char work[SIZE_AQK2R_MIN_WORK_BUF];
    char reading[8192];
    char line[4096];
    FILE *file;
    if (argc != 2 || !(file = fopen(argv[1], "rb"))) return 1;
    fseek(file, 0, SEEK_END);
    dictionary_size = (size_t)ftell(file);
    rewind(file);
    dictionary = malloc(dictionary_size);
    if (!dictionary || fread(dictionary, 1, dictionary_size, file) != dictionary_size) return 2;
    fclose(file);
    if (CAqK2R_Create(work, sizeof(work))) return 3;
    while (fgets(line, sizeof(line), stdin)) {
        size_t n = strlen(line);
        while (n && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = 0;
        unsigned int error = CAqK2R_Convert(line, reading, sizeof(reading));
        printf("err=%u\treading=%s\n", error, error ? "(failed)" : reading);
    }
    CAqK2R_Release();
    free(dictionary);
    return 0;
}

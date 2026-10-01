import { NextRequest, NextResponse } from 'next/server';

import {
  cancelFalTask,
  FalApiError,
  getFalTask,
  submitFalTask,
} from '@/lib/fal/server';
import { resolveFalVariant, validateFalInput } from '@/lib/fal/catalog';
import {
  FalRequestBodyTooLarge,
  parseBoundedFalJson,
} from '@/lib/fal/request-body';
import type { FalInputMode, FalMediaType, FalValue } from '@/lib/fal/types';
import { floorRejection, honoredModeration } from '@/lib/moderation/guard';

const GENERIC_FAL_ERROR = 'Something went wrong while contacting fal.';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_QUEUE_BODY_BYTES = 64 * 1024;
const MAX_API_KEY_LENGTH = 1024;
const MAX_MODEL_ID_LENGTH = 128;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_UPLOAD_URLS = 16;
const MAX_UPLOAD_URL_LENGTH = 4096;
const MAX_VALUE_ENTRIES = 64;
const MAX_VALUE_KEY_LENGTH = 128;
const MAX_VALUE_STRING_LENGTH = 4096;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isMediaType(value: unknown): value is FalMediaType {
  return value === 'image' || value === 'video';
}

function isInputMode(value: unknown): value is FalInputMode {
  return value === 'text' || value === 'image' || value === 'frames';
}

function isFalValue(value: unknown): value is FalValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isFalValues(value: unknown): value is Record<string, FalValue> {
  return isPlainObject(value) && Object.values(value).every(isFalValue);
}

function isUploadUrls(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((url) => typeof url === 'string');
}

function submitFieldsTooLarge(args: {
  prompt: string;
  uploadUrls: string[];
  values: Record<string, FalValue>;
}): boolean {
  const entries = Object.entries(args.values);
  return (
    args.prompt.length > MAX_PROMPT_LENGTH ||
    args.uploadUrls.length > MAX_UPLOAD_URLS ||
    args.uploadUrls.some((url) => url.length > MAX_UPLOAD_URL_LENGTH) ||
    entries.length > MAX_VALUE_ENTRIES ||
    entries.some(
      ([key, value]) =>
        key.length > MAX_VALUE_KEY_LENGTH ||
        (typeof value === 'string' && value.length > MAX_VALUE_STRING_LENGTH)
    )
  );
}

function supportsFalRequest(args: {
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  prompt: string;
  uploadUrls: string[];
}): boolean {
  try {
    const variant = resolveFalVariant(args.modelId, args.mediaType, args.inputMode);
    if (args.inputMode === 'text' && args.uploadUrls.length > 0) return false;
    return validateFalInput(variant, args) === null;
  } catch {
    return false;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof FalApiError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ success: false, error: GENERIC_FAL_ERROR }, { status: 500 });
}

function invalidRequest(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseBoundedFalJson(request, MAX_QUEUE_BODY_BYTES);
  } catch (error) {
    if (error instanceof FalRequestBodyTooLarge) {
      return NextResponse.json(
        { success: false, error: 'The request body is too large.' },
        { status: 413 }
      );
    }
    return invalidRequest('The request body must be valid JSON.');
  }

  if (!isPlainObject(body)) {
    return invalidRequest('The request body must be a JSON object.');
  }
  if (body.operation !== 'submit' && body.operation !== 'status' && body.operation !== 'cancel') {
    return invalidRequest('A supported queue operation is required.');
  }

  try {
    if (body.operation === 'submit') {
      if (
        !isNonBlankString(body.apiKey) ||
        !isNonBlankString(body.modelId) ||
        !isMediaType(body.mediaType) ||
        !isInputMode(body.inputMode) ||
        !isNonBlankString(body.prompt) ||
        !isUploadUrls(body.uploadUrls) ||
        !isFalValues(body.values)
      ) {
        return invalidRequest('The submit request contains missing or invalid fields.');
      }
      if (
        body.apiKey.length > MAX_API_KEY_LENGTH ||
        body.modelId.length > MAX_MODEL_ID_LENGTH
      ) {
        return invalidRequest('The submit request contains missing or invalid fields.');
      }
      const submitArgs = {
        apiKey: body.apiKey,
        modelId: body.modelId,
        mediaType: body.mediaType,
        inputMode: body.inputMode,
        prompt: body.prompt,
        uploadUrls: body.uploadUrls,
        values: body.values,
      };
      if (submitFieldsTooLarge(submitArgs)) {
        return NextResponse.json(
          { success: false, error: 'The request body is too large.' },
          { status: 413 }
        );
      }
      if (!supportsFalRequest(submitArgs)) {
        return invalidRequest('The selected fal request is not supported.');
      }

      const prompt = submitArgs.prompt.trim();
      const blocked = floorRejection(prompt);
      if (blocked) return blocked;
      const moderation = await honoredModeration({
        requested: submitArgs.values.moderation,
        prompt,
        hasReferences: submitArgs.uploadUrls.length > 0,
        request,
      });
      const values = { ...submitArgs.values };
      if (moderation === 'relaxed') values.moderation = 'relaxed';
      else delete values.moderation;
      const { requestId } = await submitFalTask({
        ...submitArgs,
        values,
        apiKey: submitArgs.apiKey.trim(),
        modelId: submitArgs.modelId.trim(),
        prompt,
      });
      return NextResponse.json({ success: true, requestId });
    }

    if (
      !isNonBlankString(body.apiKey) ||
      !isNonBlankString(body.modelId) ||
      !isMediaType(body.mediaType) ||
      !isInputMode(body.inputMode) ||
      typeof body.requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(body.requestId) ||
      body.apiKey.length > MAX_API_KEY_LENGTH ||
      body.modelId.length > MAX_MODEL_ID_LENGTH
    ) {
      return invalidRequest('The queue request contains missing or invalid fields.');
    }

    const taskArgs = {
      apiKey: body.apiKey.trim(),
      modelId: body.modelId.trim(),
      mediaType: body.mediaType,
      inputMode: body.inputMode,
      requestId: body.requestId,
    };

    if (body.operation === 'status') {
      const task = await getFalTask(taskArgs);
      return NextResponse.json({ success: true, task });
    }

    await cancelFalTask(taskArgs);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

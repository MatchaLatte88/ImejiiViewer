import models from '../../../shared/ai-models.json'

export const manifest = Object.freeze({
  id: 'ai-cutout', version: '1.1.0', hostApi: 1,
  name: 'Background removal', label: 'AI Cutout', icon: 'layers',
  description: 'Subject Studio: cut out, develop subject and background separately, compose product photos and reuse the mask.',
  action: 'Cut out the subject', resultSuffix: 'cutout', operation: 'background-removal',
  guidance: 'Automatic subject mask with soft edges and manual refinement. Hair, glass and overlapping subjects may need corrections.',
  attribution: 'BiRefNet by Peng Zheng and contributors. ONNX conversion by ONNX Community.',
  runtime: 'ONNX Runtime Node 1.29.0 (MIT), isolated CPU process',
  requirements: '16 GB system RAM recommended. CPU inference can temporarily use 6+ GB; memory is released afterwards.',
  capabilities: ['photo.snapshot', 'photo.variant', 'photo.compose', 'photo.mask-handoff', 'photo.mask-export', 'model.birefnet-lite-v1'],
  model: Object.freeze(models['birefnet-lite-v1']),
})

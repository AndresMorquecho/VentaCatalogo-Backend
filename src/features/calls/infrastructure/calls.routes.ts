import { Router } from 'express';
import { CallController } from './CallController';
import { GetCallsUseCase } from '../application/GetCalls.usecase';
import { CreateCallUseCase } from '../application/CreateCall.usecase';
import { UpdateCallUseCase } from '../application/UpdateCall.usecase';
import { DeleteCallUseCase } from '../application/DeleteCall.usecase';
import { PrismaCallRepository } from './PrismaCallRepository';
import { authenticate } from '../../../middleware/auth';

const router = Router();

const callRepository = new PrismaCallRepository();

const getCallsUseCase = new GetCallsUseCase(callRepository);
const createCallUseCase = new CreateCallUseCase(callRepository);
const updateCallUseCase = new UpdateCallUseCase(callRepository);
const deleteCallUseCase = new DeleteCallUseCase(callRepository);

const callController = new CallController(
    getCallsUseCase,
    createCallUseCase,
    updateCallUseCase,
    deleteCallUseCase
);

router.get('/', authenticate, callController.getAll);
router.post('/', authenticate, callController.create);
router.put('/:id', authenticate, callController.update);
router.delete('/:id', authenticate, callController.delete);

export default router;
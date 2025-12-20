import type { NextFunction, Request, Response } from "express";

/**
 * Function wrapper for Express to properly handle async exceptions in routes.
 */
export const route = (fn: (req: Request, res: Response, next: NextFunction) => any) => (req, res, next) => {
    try {
        // @ts-ignore
        fn(req, res, next).catch(ex => next(ex));
    }
    catch (ex) {
        next(ex);
    }
}


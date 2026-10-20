// Note: SimplifiedOutputArea seems to simply behave like
// the regular OutputAreas inside the notebook
// Currently trying to use regular OutputAreas
// because they *might* have more features
// In caseof problems, use Simplified
import {
    OutputArea,
    OutputAreaModel
} from '@jupyterlab/outputarea';

import {
    IRenderMimeRegistry,
}
    from '@jupyterlab/rendermime';

export function createOutputArea(rendermime: IRenderMimeRegistry, cls: string[], id: string): OutputArea {
    /**
      * Creates an OutputArea inside 'tab', in which the output of executed pythonCode will displayed
      *
      * Parameters:
      * rendermime: Required for rendering the output
      * tab: The tab the OutputArea is created in
      * cls: HTML/DOM classes the OutputArea belongs to; used for styling with CSS and possibly DOM manipulation
              later on
      * id: HTML/DOM id of the OutputArea; used for styling with CSS and possibly DOM manipulation later on
      */
    // Create an OutputArea
    // OutputAreas are used to display stuff, just like the outputs below every cell
    let model = new OutputAreaModel({ trusted: true });
    let outarea = new OutputArea({ rendermime: rendermime as any, model });
    // Set HTML/DOM id and classes
    outarea.id = id;
    for (let currCls of cls) {
        outarea.addClass(currCls);
    }
    return outarea;
}
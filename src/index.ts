import dateUtils from './dateUtils';
import { $, createSVG } from './svgUtils';
import Bar from './bar';
import Arrow from './arrow';
import Popup from './popup';

import './gantt.scss';

export interface Task {
  id: string,
  name: string,
  start: string | Date,
  end: string | Date,
  progress: number,
  dependencies?: string | string[],
  custom_class?: string
}

export interface ResolvedTask extends Task {
  invalid?: boolean;
  indexResolved: number;
  endResolved: Date;
  dependencies: string[],
  startResolved: Date;
}

export type ViewMode = 'Quarter Day' | 'Half Day' | 'Day' | 'Week' | 'Month' | 'Year';

export interface Options {
  header_height?: number,
  column_width?: number,
  step?: number,
  view_modes?: ViewMode[],
  bar_height?: number,
  bar_corner_radius?: number,
  arrow_curve?: number,
  padding?: number,
  view_mode?: ViewMode,
  date_format?: string,
  custom_popup_html?: string | null,
  popup_trigger: string,
  language: string
}

const VIEW_MODE: {
  QUARTER_DAY: 'Quarter Day',
  HALF_DAY: 'Half Day',
  DAY: 'Day',
  WEEK: 'Week',
  MONTH: 'Month',
  YEAR: 'Year',
} = {
  QUARTER_DAY: 'Quarter Day',
  HALF_DAY: 'Half Day',
  DAY: 'Day',
  WEEK: 'Week',
  MONTH: 'Month',
  YEAR: 'Year',
};

function generateId(task: ResolvedTask): string {
  return (
    `${task.name
    }_${
      Math.random()
        .toString(36)
        .slice(2, 12)}`
  );
}

export default class Gantt {
  private $svg: SVGElement;

  private $container: HTMLDivElement;

  private popupWrapper: HTMLDivElement;

  private options: Options;

  private tasks: ResolvedTask[];

  private dependencyMap: Record<string, unknown[]>;

  private ganttStart: null | Date;

  private ganttEnd: null | Date;

  private dates: Date[];

  constructor(
    wrapper: string | HTMLElement | SVGElement | unknown,
    tasks: Task[],
    options: Options,
  ) {
    this.setup_wrapper(wrapper);
    this.setup_options(options);
    this.setup_tasks(tasks);
    // initialize with default view mode
    this.change_view_mode();
    this.bind_events();
  }

  setup_wrapper(elementReference: string | HTMLElement | SVGElement | unknown) {
    let svgElement;
    let wrapperElement;

    let resolvedElementReference: HTMLElement | SVGElement | unknown;

    // CSS Selector is passed
    if (typeof elementReference === 'string') {
      resolvedElementReference = document.querySelector(elementReference);
    } else {
      resolvedElementReference = elementReference;
    }

    // get the SVGElement
    if (resolvedElementReference instanceof HTMLElement) {
      wrapperElement = resolvedElementReference;
      svgElement = resolvedElementReference.querySelector('svg');
    } else if (resolvedElementReference instanceof SVGElement) {
      svgElement = resolvedElementReference;
    } else {
      throw new TypeError(
        'Frappé Gantt only supports usage of a string CSS selector,'
                + ' HTML DOM element or SVG DOM element for the \'element\' parameter',
      );
    }

    // svg element
    if (!svgElement) {
      // create it
      this.$svg = createSVG('svg', {
        append_to: wrapperElement,
        class: 'gantt',
      });
    } else {
      this.$svg = svgElement;
      this.$svg.classList.add('gantt');
    }

    // wrapper element
    this.$container = document.createElement('div');
    this.$container.classList.add('gantt-container');

    const { parentElement } = this.$svg;
    parentElement.appendChild(this.$container);
    this.$container.appendChild(this.$svg);

    // popup wrapper
    this.popupWrapper = document.createElement('div');
    this.popupWrapper.classList.add('popup-wrapper');
    this.$container.appendChild(this.popupWrapper);
  }

  setup_options(options: Options) {
    const defaultOptions: Options = {
      header_height: 50,
      column_width: 30,
      step: 24,
      view_modes: [...Object.values(VIEW_MODE)] as ViewMode[],
      bar_height: 20,
      bar_corner_radius: 3,
      arrow_curve: 5,
      padding: 18,
      view_mode: 'Day',
      date_format: 'YYYY-MM-DD',
      popup_trigger: 'click',
      custom_popup_html: null,
      language: 'en',
    };
    this.options = { ...defaultOptions, ...options };
  }

  setup_tasks(tasks: Task[]) {
    // prepare tasks
    this.tasks = tasks.map((task, i): ResolvedTask => {
      let dependencies: string[] = [];

      // dependencies
      if (typeof task.dependencies === 'string') {
        dependencies = task.dependencies
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d);
      } else if (dependencies) {
        dependencies = task.dependencies;
      }

      const resolvedTask: ResolvedTask = {
        ...task,
        startResolved: dateUtils.parse(task.start),
        endResolved: dateUtils.parse(task.end),
        indexResolved: i,
        dependencies,
      };

      // make task invalid if duration too large
      if (dateUtils.diff(resolvedTask.endResolved, resolvedTask.startResolved, 'year') > 10) {
        resolvedTask.end = null;
      }

      // cache index

      // invalid dates
      if (!resolvedTask.start && !resolvedTask.end) {
        const today = dateUtils.today();
        resolvedTask.startResolved = today;
        resolvedTask.endResolved = dateUtils.add(today, 2, 'day');
      }

      if (!resolvedTask.start && resolvedTask.end) {
        resolvedTask.startResolved = dateUtils.add(resolvedTask.endResolved, -2, 'day');
      }

      if (resolvedTask.start && !resolvedTask.end) {
        resolvedTask.endResolved = dateUtils.add(resolvedTask.startResolved, 2, 'day');
      }

      // if hours is not set, assume the last day is full day
      // e.g: 2018-09-09 becomes 2018-09-09 23:59:59
      const taskEndValues = dateUtils.get_date_values(resolvedTask.endResolved);
      if (taskEndValues.slice(3)
        .every((d) => d === 0)) {
        resolvedTask.endResolved = dateUtils.add(resolvedTask.endResolved, 24, 'hour');
      }

      // invalid flag
      if (!resolvedTask.start || !resolvedTask.end) {
        resolvedTask.invalid = true;
      }

      // uids
      if (!resolvedTask.id) {
        resolvedTask.id = generateId(resolvedTask);
      }

      return resolvedTask;
    });

    this.setupDependencies();
  }

  setupDependencies() {
    this.dependencyMap = {};
    this.tasks.forEach((t) => {
      t.dependencies.forEach((d) => {
        this.dependencyMap[d] = this.dependencyMap[d] || [];
        this.dependencyMap[d].push(t.id);
      });
    });
  }

  refresh(tasks: Task[]) {
    this.setup_tasks(tasks);
    this.change_view_mode();
  }

  change_view_mode(mode: ViewMode = this.options.view_mode) {
    this.update_view_scale(mode);
    this.setup_dates();
    this.render();
    // fire viewmode_change event
    this.trigger_event('view_change', [mode]);
  }

  update_view_scale(view_mode: ViewMode) {
    this.options.view_mode = view_mode;

    switch (view_mode) {
      case 'Quarter Day':
        this.options.step = 24 / 4;
        this.options.column_width = 38;
        break;
      case 'Half Day':
        this.options.step = 24 / 2;
        this.options.column_width = 38;
        break;
      case 'Day':
        this.options.step = 24;
        this.options.column_width = 38;
        break;
      case 'Week':
        this.options.step = 24 * 7;
        this.options.column_width = 140;
        break;
      case 'Month':
        this.options.step = 24 * 30;
        this.options.column_width = 120;
        break;
      case 'Year':
        this.options.step = 24 * 365;
        this.options.column_width = 120;
        break;
      default:
        // eslint-disable-next-line no-console
        console.error(`Unknown view mode used: ${view_mode}`);
    }
  }

  setup_dates() {
    this.setup_gantt_dates();
    this.setup_date_values();
  }

  setup_gantt_dates() {
    this.ganttStart = null;
    this.ganttEnd = null;

    this.tasks.forEach((task) => {
      // set global start and end date
      if (!this.ganttStart || task.startResolved < this.ganttStart) {
        this.ganttStart = task.startResolved;
      }
      if (!this.ganttEnd || task.endResolved > this.ganttEnd) {
        this.ganttEnd = task.endResolved;
      }
    });

    this.ganttStart = dateUtils.start_of(this.ganttStart, 'day');
    this.ganttEnd = dateUtils.start_of(this.ganttEnd, 'day');

    // add date padding on both sides
    if (this.view_is([VIEW_MODE.QUARTER_DAY, VIEW_MODE.HALF_DAY])) {
      this.ganttStart = dateUtils.add(this.ganttStart, -7, 'day');
      this.ganttEnd = dateUtils.add(this.ganttEnd, 7, 'day');
    } else if (this.view_is(VIEW_MODE.MONTH)) {
      this.ganttStart = dateUtils.start_of(this.ganttStart, 'year');
      this.ganttEnd = dateUtils.add(this.ganttEnd, 1, 'year');
    } else if (this.view_is(VIEW_MODE.YEAR)) {
      this.ganttStart = dateUtils.add(this.ganttStart, -2, 'year');
      this.ganttEnd = dateUtils.add(this.ganttEnd, 2, 'year');
    } else {
      this.ganttStart = dateUtils.add(this.ganttStart, -1, 'month');
      this.ganttEnd = dateUtils.add(this.ganttEnd, 1, 'month');
    }
  }

  setup_date_values() {
    this.dates = [];
    let currentDate: Date | null = null;

    while (currentDate === null || currentDate < this.ganttEnd) {
      if (!currentDate) {
        currentDate = dateUtils.clone(this.ganttStart);
      } else if (this.view_is(VIEW_MODE.YEAR)) {
        currentDate = dateUtils.add(currentDate, 1, 'year');
      } else if (this.view_is(VIEW_MODE.MONTH)) {
        currentDate = dateUtils.add(currentDate, 1, 'month');
      } else {
        currentDate = dateUtils.add(
          currentDate,
          this.options.step,
          'hour',
        );
      }
      this.dates.push(currentDate);
    }
  }

  bind_events() {
    this.bind_grid_click();
    this.bind_bar_events();
  }

  render() {
    this.clear();
    this.setup_layers();
    this.make_grid();
    this.make_dates();
    this.make_bars();
    this.make_arrows();
    this.map_arrows_on_bars();
    this.set_width();
    this.set_scroll_position();
  }

  setup_layers() {
    this.layers = {};
    const layers = ['grid', 'date', 'arrow', 'progress', 'bar', 'details'];
    // make group layers
    for (const layer of layers) {
      this.layers[layer] = createSVG('g', {
        class: layer,
        append_to: this.$svg,
      });
    }
  }

  make_grid() {
    this.make_grid_background();
    this.make_grid_rows();
    this.make_grid_header();
    this.make_grid_ticks();
    this.make_grid_highlights();
  }

  make_grid_background() {
    const grid_width = this.dates.length * this.options.column_width;
    const grid_height = this.options.header_height
            + this.options.padding
            + (this.options.bar_height + this.options.padding)
            * this.tasks.length;

    createSVG('rect', {
      x: 0,
      y: 0,
      width: grid_width,
      height: grid_height,
      class: 'grid-background',
      append_to: this.layers.grid,
    });

    $.attr(this.$svg, {
      height: grid_height + this.options.padding + 100,
      width: '100%',
    });
  }

  make_grid_rows() {
    const rows_layer = createSVG('g', { append_to: this.layers.grid });
    const lines_layer = createSVG('g', { append_to: this.layers.grid });

    const row_width = this.dates.length * this.options.column_width;
    const row_height = this.options.bar_height + this.options.padding;

    let row_y = this.options.header_height + this.options.padding / 2;

    for (const task of this.tasks) {
      createSVG('rect', {
        x: 0,
        y: row_y,
        width: row_width,
        height: row_height,
        class: 'grid-row',
        append_to: rows_layer,
      });

      createSVG('line', {
        x1: 0,
        y1: row_y + row_height,
        x2: row_width,
        y2: row_y + row_height,
        class: 'row-line',
        append_to: lines_layer,
      });

      row_y += this.options.bar_height + this.options.padding;
    }
  }

  make_grid_header() {
    const header_width = this.dates.length * this.options.column_width;
    const header_height = this.options.header_height + 10;
    createSVG('rect', {
      x: 0,
      y: 0,
      width: header_width,
      height: header_height,
      class: 'grid-header',
      append_to: this.layers.grid,
    });
  }

  make_grid_ticks() {
    let tick_x = 0;
    const tick_y = this.options.header_height + this.options.padding / 2;
    const tick_height = (this.options.bar_height + this.options.padding)
            * this.tasks.length;

    for (const date of this.dates) {
      let tick_class = 'tick';
      // thick tick for monday
      if (this.view_is(VIEW_MODE.DAY) && date.getDate() === 1) {
        tick_class += ' thick';
      }
      // thick tick for first week
      if (
        this.view_is(VIEW_MODE.WEEK)
                && date.getDate() >= 1
                && date.getDate() < 8
      ) {
        tick_class += ' thick';
      }
      // thick ticks for quarters
      if (this.view_is(VIEW_MODE.MONTH) && (date.getMonth() + 1) % 3 === 0) {
        tick_class += ' thick';
      }

      createSVG('path', {
        d: `M ${tick_x} ${tick_y} v ${tick_height}`,
        class: tick_class,
        append_to: this.layers.grid,
      });

      if (this.view_is(VIEW_MODE.MONTH)) {
        tick_x
                    += dateUtils.get_days_in_month(date)
                    * this.options.column_width
                    / 30;
      } else {
        tick_x += this.options.column_width;
      }
    }
  }

  make_grid_highlights() {
    // highlight today's date
    if (this.view_is(VIEW_MODE.DAY)) {
      const x = dateUtils.diff(dateUtils.today(), this.ganttStart, 'hour')
                / this.options.step
                * this.options.column_width;
      const y = 0;

      const width = this.options.column_width;
      const height = (this.options.bar_height + this.options.padding)
                * this.tasks.length
                + this.options.header_height
                + this.options.padding / 2;

      createSVG('rect', {
        x,
        y,
        width,
        height,
        class: 'today-highlight',
        append_to: this.layers.grid,
      });
    }
  }

  make_dates() {
    for (const date of this.get_dates_to_draw()) {
      createSVG('text', {
        x: date.lower_x,
        y: date.lower_y,
        innerHTML: date.lower_text,
        class: 'lower-text',
        append_to: this.layers.date,
      });

      if (date.upper_text) {
        const $upper_text = createSVG('text', {
          x: date.upper_x,
          y: date.upper_y,
          innerHTML: date.upper_text,
          class: 'upper-text',
          append_to: this.layers.date,
        });

        // remove out-of-bound dates
        if (
          $upper_text.getBBox().x2 > this.layers.grid.getBBox().width
        ) {
          $upper_text.remove();
        }
      }
    }
  }

  get_dates_to_draw() {
    let last_date = null;
    const dates = this.dates.map((date, i) => {
      const d = this.get_date_info(date, last_date, i);
      last_date = date;
      return d;
    });
    return dates;
  }

  get_date_info(date, last_date, i) {
    if (!last_date) {
      last_date = dateUtils.add(date, 1, 'year');
    }
    const date_text = {
      'Quarter Day_lower': dateUtils.format(
        date,
        'HH',
        this.options.language,
      ),
      'Half Day_lower': dateUtils.format(
        date,
        'HH',
        this.options.language,
      ),
      Day_lower:
                date.getDate() !== last_date.getDate()
                  ? dateUtils.format(date, 'D', this.options.language)
                  : '',
      Week_lower:
                date.getMonth() !== last_date.getMonth()
                  ? dateUtils.format(date, 'D MMM', this.options.language)
                  : dateUtils.format(date, 'D', this.options.language),
      Month_lower: dateUtils.format(date, 'MMMM', this.options.language),
      Year_lower: dateUtils.format(date, 'YYYY', this.options.language),
      'Quarter Day_upper':
                date.getDate() !== last_date.getDate()
                  ? dateUtils.format(date, 'D MMM', this.options.language)
                  : '',
      'Half Day_upper':
                date.getDate() !== last_date.getDate()
                  ? date.getMonth() !== last_date.getMonth()
                    ? dateUtils.format(date, 'D MMM', this.options.language)
                    : dateUtils.format(date, 'D', this.options.language)
                  : '',
      Day_upper:
                date.getMonth() !== last_date.getMonth()
                  ? dateUtils.format(date, 'MMMM', this.options.language)
                  : '',
      Week_upper:
                date.getMonth() !== last_date.getMonth()
                  ? dateUtils.format(date, 'MMMM', this.options.language)
                  : '',
      Month_upper:
                date.getFullYear() !== last_date.getFullYear()
                  ? dateUtils.format(date, 'YYYY', this.options.language)
                  : '',
      Year_upper:
                date.getFullYear() !== last_date.getFullYear()
                  ? dateUtils.format(date, 'YYYY', this.options.language)
                  : '',
    };

    const base_pos = {
      x: i * this.options.column_width,
      lower_y: this.options.header_height,
      upper_y: this.options.header_height - 25,
    };

    const x_pos = {
      'Quarter Day_lower': this.options.column_width * 4 / 2,
      'Quarter Day_upper': 0,
      'Half Day_lower': this.options.column_width * 2 / 2,
      'Half Day_upper': 0,
      Day_lower: this.options.column_width / 2,
      Day_upper: this.options.column_width * 30 / 2,
      Week_lower: 0,
      Week_upper: this.options.column_width * 4 / 2,
      Month_lower: this.options.column_width / 2,
      Month_upper: this.options.column_width * 12 / 2,
      Year_lower: this.options.column_width / 2,
      Year_upper: this.options.column_width * 30 / 2,
    };

    return {
      upper_text: date_text[`${this.options.view_mode}_upper`],
      lower_text: date_text[`${this.options.view_mode}_lower`],
      upper_x: base_pos.x + x_pos[`${this.options.view_mode}_upper`],
      upper_y: base_pos.upper_y,
      lower_x: base_pos.x + x_pos[`${this.options.view_mode}_lower`],
      lower_y: base_pos.lower_y,
    };
  }

  make_bars() {
    this.bars = this.tasks.map((task) => {
      const bar = new Bar(this, task);
      this.layers.bar.appendChild(bar.group);
      return bar;
    });
  }

  make_arrows() {
    this.arrows = [];
    for (const task of this.tasks) {
      let arrows = [];
      arrows = task.dependencies
        .map((task_id) => {
          const dependency = this.get_task(task_id);
          if (!dependency) return;
          const arrow = new Arrow(
            this,
            this.bars[dependency._index], // from_task
            this.bars[task._index], // to_task
          );
          this.layers.arrow.appendChild(arrow.element);
          return arrow;
        })
        .filter(Boolean); // filter falsy values
      this.arrows = this.arrows.concat(arrows);
    }
  }

  map_arrows_on_bars() {
    for (const bar of this.bars) {
      bar.arrows = this.arrows.filter((arrow) => (
        arrow.from_task.task.id === bar.task.id
                || arrow.to_task.task.id === bar.task.id
      ));
    }
  }

  set_width() {
    const cur_width = this.$svg.getBoundingClientRect().width;
    const actual_width = this.$svg
      .querySelector('.grid .grid-row')
      .getAttribute('width');
    if (cur_width < actual_width) {
      this.$svg.setAttribute('width', actual_width);
    }
  }

  set_scroll_position() {
    const parent_element = this.$svg.parentElement;
    if (!parent_element) return;

    const hours_before_first_task = dateUtils.diff(
      this.get_oldest_starting_date(),
      this.ganttStart,
      'hour',
    );

    const scroll_pos = hours_before_first_task
            / this.options.step
            * this.options.column_width
            - this.options.column_width;

    parent_element.scrollLeft = scroll_pos;
  }

  bind_grid_click() {
    $.on(
      this.$svg,
      this.options.popup_trigger,
      '.grid-row, .grid-header',
      () => {
        this.unselect_all();
        this.hide_popup();
      },
    );
  }

  bind_bar_events() {
    let is_dragging = false;
    let x_on_start = 0;
    let y_on_start = 0;
    let is_resizing_left = false;
    let is_resizing_right = false;
    let parent_bar_id = null;
    let bars = []; // instanceof Bar
    this.bar_being_dragged = null;

    function action_in_progress() {
      return is_dragging || is_resizing_left || is_resizing_right;
    }

    $.on(this.$svg, 'mousedown', '.bar-wrapper, .handle', (e, element) => {
      const bar_wrapper = $.closest('.bar-wrapper', element);

      if (element.classList.contains('left')) {
        is_resizing_left = true;
      } else if (element.classList.contains('right')) {
        is_resizing_right = true;
      } else if (element.classList.contains('bar-wrapper')) {
        is_dragging = true;
      }

      bar_wrapper.classList.add('active');

      x_on_start = e.offsetX;
      y_on_start = e.offsetY;

      parent_bar_id = bar_wrapper.getAttribute('data-id');
      const ids = [
        parent_bar_id,
        ...this.get_all_dependent_tasks(parent_bar_id),
      ];
      bars = ids.map((id) => this.get_bar(id));

      this.bar_being_dragged = parent_bar_id;

      bars.forEach((bar) => {
        const { $bar } = bar;
        $bar.ox = $bar.getX();
        $bar.oy = $bar.getY();
        $bar.owidth = $bar.getWidth();
        $bar.finaldx = 0;
      });
    });

    $.on(this.$svg, 'mousemove', (e) => {
      if (!action_in_progress()) return;
      const dx = e.offsetX - x_on_start;
      const dy = e.offsetY - y_on_start;

      bars.forEach((bar) => {
        const { $bar } = bar;
        $bar.finaldx = this.get_snap_position(dx);

        if (is_resizing_left) {
          if (parent_bar_id === bar.task.id) {
            bar.update_bar_position({
              x: $bar.ox + $bar.finaldx,
              width: $bar.owidth - $bar.finaldx,
            });
          } else {
            bar.update_bar_position({
              x: $bar.ox + $bar.finaldx,
            });
          }
        } else if (is_resizing_right) {
          if (parent_bar_id === bar.task.id) {
            bar.update_bar_position({
              width: $bar.owidth + $bar.finaldx,
            });
          }
        } else if (is_dragging) {
          bar.update_bar_position({ x: $bar.ox + $bar.finaldx });
        }
      });
    });

    document.addEventListener('mouseup', (e) => {
      if (is_dragging || is_resizing_left || is_resizing_right) {
        bars.forEach((bar) => bar.group.classList.remove('active'));
      }

      is_dragging = false;
      is_resizing_left = false;
      is_resizing_right = false;
    });

    $.on(this.$svg, 'mouseup', (e) => {
      this.bar_being_dragged = null;
      bars.forEach((bar) => {
        const { $bar } = bar;
        if (!$bar.finaldx) return;
        bar.date_changed();
        bar.set_action_completed();
      });
    });

    this.bind_bar_progress();
  }

  bind_bar_progress() {
    let x_on_start = 0;
    let y_on_start = 0;
    let is_resizing = null;
    let bar = null;
    let $bar_progress = null;
    let $bar = null;

    $.on(this.$svg, 'mousedown', '.handle.progress', (e, handle) => {
      is_resizing = true;
      x_on_start = e.offsetX;
      y_on_start = e.offsetY;

      const $bar_wrapper = $.closest('.bar-wrapper', handle);
      const id = $bar_wrapper.getAttribute('data-id');
      bar = this.get_bar(id);

      $bar_progress = bar.$bar_progress;
      $bar = bar.$bar;

      $bar_progress.finaldx = 0;
      $bar_progress.owidth = $bar_progress.getWidth();
      $bar_progress.min_dx = -$bar_progress.getWidth();
      $bar_progress.max_dx = $bar.getWidth() - $bar_progress.getWidth();
    });

    $.on(this.$svg, 'mousemove', (e) => {
      if (!is_resizing) return;
      let dx = e.offsetX - x_on_start;
      const dy = e.offsetY - y_on_start;

      if (dx > $bar_progress.max_dx) {
        dx = $bar_progress.max_dx;
      }
      if (dx < $bar_progress.min_dx) {
        dx = $bar_progress.min_dx;
      }

      const $handle = bar.$handle_progress;
      $.attr($bar_progress, 'width', $bar_progress.owidth + dx);
      $.attr($handle, 'points', bar.get_progress_polygon_points());
      $bar_progress.finaldx = dx;
    });

    $.on(this.$svg, 'mouseup', () => {
      is_resizing = false;
      if (!($bar_progress && $bar_progress.finaldx)) return;
      bar.progress_changed();
      bar.set_action_completed();
    });
  }

  get_all_dependent_tasks(task_id) {
    let out = [];
    let to_process = [task_id];
    while (to_process.length) {
      const deps = to_process.reduce((acc, curr) => {
        acc = acc.concat(this.dependencyMap[curr]);
        return acc;
      }, []);

      out = out.concat(deps);
      to_process = deps.filter((d) => !to_process.includes(d));
    }

    return out.filter(Boolean);
  }

  get_snap_position(dx) {
    const odx = dx;
    let rem;
    let position;

    if (this.view_is(VIEW_MODE.WEEK)) {
      rem = dx % (this.options.column_width / 7);
      position = odx
                - rem
                + (rem < this.options.column_width / 14
                  ? 0
                  : this.options.column_width / 7);
    } else if (this.view_is(VIEW_MODE.MONTH)) {
      rem = dx % (this.options.column_width / 30);
      position = odx
                - rem
                + (rem < this.options.column_width / 60
                  ? 0
                  : this.options.column_width / 30);
    } else {
      rem = dx % this.options.column_width;
      position = odx
                - rem
                + (rem < this.options.column_width / 2
                  ? 0
                  : this.options.column_width);
    }
    return position;
  }

  unselect_all() {
    [...this.$svg.querySelectorAll('.bar-wrapper')].forEach((el) => {
      el.classList.remove('active');
    });
  }

  view_is(modes) {
    if (typeof modes === 'string') {
      return this.options.view_mode === modes;
    }

    if (Array.isArray(modes)) {
      return modes.some((mode) => this.options.view_mode === mode);
    }

    return false;
  }

  get_task(id) {
    return this.tasks.find((task) => task.id === id);
  }

  get_bar(id) {
    return this.bars.find((bar) => bar.task.id === id);
  }

  show_popup(options) {
    if (!this.popup) {
      this.popup = new Popup(
        this.popupWrapper,
        this.options.custom_popup_html,
      );
    }
    this.popup.show(options);
  }

  hide_popup() {
    this.popup && this.popup.hide();
  }

  trigger_event(event, args) {
    if (this.options[`on_${event}`]) {
      this.options[`on_${event}`].apply(null, args);
    }
  }

  /**
     * Gets the oldest starting date from the list of tasks
     *
     * @returns Date
     * @memberof Gantt
     */
  get_oldest_starting_date() {
    return this.tasks
      .map((task) => task._start)
      .reduce(
        (prev_date, cur_date) => (cur_date <= prev_date ? cur_date : prev_date),
      );
  }

  /**
     * Clear all elements from the parent svg element
     *
     * @memberof Gantt
     */
  clear() {
    this.$svg.innerHTML = '';
  }
}

Gantt.VIEW_MODE = VIEW_MODE;
